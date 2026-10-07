process.env.TZ = 'UTC'; // Golden expectations were generated in UTC; Python receives host local parts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ActivityCore, PythonWorker, resolvePython, workerEnv, localParts } from '../python-core.ts';
import { scenario, drive } from './activity-scenarios.mjs';

const golden = JSON.parse(fs.readFileSync(new URL('./fixtures/activity-golden.json', import.meta.url), 'utf8'));
const python = process.env.PITOOLS_SKIP_PYTHON ? undefined : resolvePython();
const needsPython = { skip: python ? false : 'no Python 3 interpreter found (set PITOOLS_PYTHON)' };

test('TS core and host frames still produce the committed golden activity fixture', () => {
  for (const expected of golden.scenarios) {
    const actual = scenario(expected.seed, 36, expected.locale);
    assert.deepEqual(actual, expected, `seed ${expected.seed}`);
  }
});

test('interpreter resolution is explicit and never relative to the session cwd', () => {
  assert.equal(resolvePython({ PITOOLS_PYTHON: 'relative/python' }), undefined);
  assert.equal(resolvePython({ PITOOLS_PYTHON: path.join(os.tmpdir(), 'pitools-no-such-python') }), undefined);
  assert.equal(resolvePython({ PATH: `.${path.delimiter}bin` }, 'linux'), undefined);
  const env = workerEnv({ PATH: '/x', OPENAI_API_KEY: 'secret', SYSTEMROOT: 'C:\\Windows', HOME: '/home/u' }, 'win32');
  assert.deepEqual(env, { SYSTEMROOT: 'C:\\Windows' });
  assert.deepEqual(workerEnv({ ANTHROPIC_API_KEY: 'secret', TMPDIR: '/tmp' }, 'darwin'), { TMPDIR: '/tmp' });
  assert.deepEqual(localParts(Date.UTC(2026, 9, 4, 5)), [2026, 10, 4, 0, 5]);
});

test('missing interpreter keeps the TS core and reports it once', async () => {
  const fallbacks = [];
  const core = new ActivityCore({ onChange() {}, onFallback: c => fallbacks.push(c), resolve: () => undefined });
  assert.equal(await core.usePython(), 'python_not_found');
  assert.equal(core.effective, 'ts');
  assert.equal(core.line(0), '🌑 ⏵ 待机中 · 等待任务');
  assert.deepEqual(fallbacks, []);
});

function drained(core, timeout = 15000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (!core.python_active) return reject(new Error(`worker stopped: ${core.failure}`));
      if (!core.expected.size && !core.worker?.requests.size && !core.worker?.deltas.length && !core.worker?.pending && !core.viewTimer && !core.viewQueued && !core.inFlight) return resolve();
      if (Date.now() - started > timeout) return reject(new Error('views did not drain'));
      setTimeout(check, 5);
    };
    check();
  });
}

test('real Python worker matches the TS core over randomized host event streams', needsPython, async () => {
  const core = new ActivityCore({ onChange() {}, onFallback() {}, resolve: () => python, verify: true });
  try {
    assert.equal(await core.usePython(), undefined, core.failure);
    assert.equal(core.effective, 'python');
    for (let seed = 100; seed < 160; seed++) {
      core.reset(seed % 3 ? undefined : { lang: 'en', frames: 'random' });
      drive(core, seed, 60);
      await drained(core);
    }
    assert.equal(core.mismatches, 0);
    assert.ok(core.matches > 3000, `compared ${core.matches} views`);
  } finally { core.dispose(); }
});

test('mid-task switch adopts TS state; render uses the fresh Python view; dispose leaves no process', needsPython, async () => {
  let changes = 0;
  const core = new ActivityCore({ onChange() { changes++; }, onFallback() {}, resolve: () => python, verify: true });
  const start = Date.now();
  core.begin(start);
  core.toolStart('a', 'bash', { command: 'npm test' }, start + 10);
  core.toolStart('b', 'read', { path: '/tmp/中文' }, start + 20);
  core.messageEnd({ content: [{ type: 'text', text: '⏵ 检查补丁' }], usage: { output: 1500 } }, start + 30);
  const expected = core.ts.line(start + 1000);
  assert.equal(await core.usePython(), undefined, core.failure);
  core.requestView(start + 1000);
  await drained(core);
  assert.equal(core.line(start + 1000), expected, 'Python view equals TS after snapshot');
  assert.ok(core.line(start + 1000).includes('2 并行'));
  core.finish(start + 5000);
  core.requestView(start + 5000); await drained(core);
  assert.ok(changes > 0); assert.equal(core.mismatches, 0);
  assert.equal(core.phase, 'done'); assert.equal(core.nextWakeAt(start + 6000), undefined);
  const child = core.worker.child;
  core.dispose();
  await new Promise(resolve => child.exitCode !== null || child.signalCode ? resolve() : child.once('exit', resolve));
  assert.equal(core.effective, 'ts');
});

function fakeWorker(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pitools-fake-'));
  const file = path.join(dir, 'fake_worker.py');
  fs.writeFileSync(file, `import sys, json\n${body}\n`);
  return { file, cleanup: () => fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 40, retryDelay: 50 }) }; // Windows may release a killed child's handles late.
}
const HELLO = `line = sys.stdin.readline()\n`;
const READY = `${HELLO}sys.stdout.write(json.dumps({"protocol":1,"type":"ready","version":"0.1.11","python":"fake"})+"\\n"); sys.stdout.flush()\n`;

test('cancelled startup settles promptly and cannot clear a subsequent startup', needsPython, async () => {
  const fake = fakeWorker('import time\ntime.sleep(60)');
  const options = { onChange() {}, onFallback() {}, resolve: () => python, script: fake.file };
  const core = new ActivityCore(options);
  let child;
  try {
    const first = core.usePython(); child = core.worker.child;
    core.useTs(); options.script = undefined;
    const second = core.usePython();
    assert.equal(await first, 'stopped');
    assert.ok(core.starting, 'old cancellation must not clear the new start promise');
    assert.equal(await second, undefined); await drained(core);
    assert.equal(core.effective, 'python');
    await new Promise(resolve => child.exitCode !== null || child.signalCode ? resolve() : child.once('exit', resolve));
  } finally { core.dispose(); await fake.cleanup(); }
});

for (const [name, body, phase, expected] of [
  ['version mismatch', `${HELLO}print(json.dumps({"protocol":1,"type":"ready","version":"0.0.1","python":"x"}), flush=True)\nsys.stdin.readline()`, 'start', 'handshake_failed'],
  ['exit before ready', 'sys.exit(1)', 'start', 'exited_before_ready'],
  ['crash after ready', `${READY}sys.stdin.readline(); sys.exit(1)`, 'run', 'exited'],
  ['bad JSON after ready', `${READY}sys.stdin.readline(); print("not json", flush=True); sys.stdin.readline()`, 'run', 'bad_json'],
  ['oversized UTF-8 frame', `${READY}sys.stdin.readline(); sys.stdout.write(json.dumps({'protocol':1,'type':'extra','text':'界'*400000},ensure_ascii=False)+'\\n'); sys.stdout.flush(); sys.stdin.readline()`, 'run', 'frame_too_large'],
  ['oversized delimited frame', `${READY}sys.stdin.readline(); sys.stdout.write('x'*1100000+'\\n'); sys.stdout.flush(); sys.stdin.readline()`, 'run', 'frame_too_large'],
  ['unsolicited view id', `${READY}sys.stdin.readline(); print(json.dumps({"protocol":1,"type":"view","epoch":1,"id":999,"line":"x","phase":"idle","failure":False,"live":False,"nextWakeAt":None}), flush=True); sys.stdin.readline()`, 'run', 'bad_view'],
  ['request timeout', `${READY}import time\nwhile sys.stdin.readline(): pass`, 'run', 'request_timeout'],
]) {
  test(`worker fault is isolated and falls back to TS: ${name}`, needsPython, async () => {
    const fake = fakeWorker(body);
    const fallbacks = [];
    const core = new ActivityCore({ onChange() {}, onFallback: c => fallbacks.push(c), resolve: () => python, script: fake.file });
    try {
      const failure = await core.usePython();
      if (phase === 'start') { assert.equal(failure, expected); assert.deepEqual(fallbacks, []); }
      else {
        assert.equal(failure, undefined);
        core.begin(Date.now()); core.requestView(Date.now());
        const until = Date.now() + 6000;
        while (!fallbacks.length && Date.now() < until) await new Promise(r => setTimeout(r, 20));
        assert.deepEqual(fallbacks, [expected]);
      }
      assert.equal(core.effective, 'ts');
      assert.ok(core.line(Date.now()).length > 0, 'TS line keeps rendering after a worker fault');
      assert.equal(core.worker, undefined);
    } finally { core.dispose(); await fake.cleanup(); }
  });
}

function capturingTransport(features = true, writableLength = 0) {
  const writes = [], failures = [];
  const worker = new PythonWorker(() => {}, category => failures.push(category));
  worker.batchEvents = features;
  worker.child = { removeAllListeners() {}, stdin: { writableLength, write(data) { writes.push(data); }, end() {}, removeAllListeners() {}, on() {} }, kill() {} };
  return {worker,writes,failures};
}
const deltaFrame = seq => ({type:'event',epoch:1,seq,op:'delta',now:1000+seq,local:[2026,4,17,5,12],kind:'text_delta',text:'中文\ud83d\n'+'x'.repeat(290)});

test('bounded batches preserve every delta and critical-event order, with captured local parts', async () => {
  const {worker,writes,failures}=capturingTransport();
  try {
    for(let i=1;i<=1600;i++) {const frame=deltaFrame(i);assert(worker.write(frame));frame.local[0]=1900;}
    assert(worker.write({type:'event',epoch:1,seq:1601,op:'finish',now:3000,local:[2026,4,17,5,12],reason:''}));
    await new Promise(r=>setImmediate(r));
    const lines=writes.join('').trim().split('\n'), frames=lines.map(JSON.parse);
    const batches=frames.filter(f=>f.type==='event_batch');assert.ok(batches.length<100);
    for(let i=0;i<lines.length;i++) if(frames[i].type==='event_batch') {assert.ok(Buffer.byteLength(lines[i])<=65536);assert.ok(frames[i].events.length<=64);}
    const deltas=batches.flatMap(f=>f.events);assert.equal(deltas.length,1600);
    for(let i=0;i<1600;i++) assert.deepEqual(deltas[i],deltaFrame(i+1));
    assert.equal(frames.at(-1).op,'finish');assert.deepEqual(failures,[]);
    assert.equal(worker.batchTimer,undefined);
  } finally {worker.stop();}
});

test('batch deadline flushes lone delta; close clears queued data; feature-less workers stay JSONL', async () => {
  const {worker,writes}=capturingTransport();
  worker.write(deltaFrame(1));assert.equal(writes.length,0);
  await new Promise(r=>setTimeout(r,30));assert.equal(JSON.parse(writes[0]).seq,1);
  worker.write(deltaFrame(2));worker.stop();const count=writes.length;
  await new Promise(r=>setTimeout(r,15));assert.equal(writes.length,count);assert.equal(worker.deltas.length,0);assert.equal(worker.batchTimer,undefined);
  const old=capturingTransport(false);old.worker.write(deltaFrame(1));await new Promise(r=>setImmediate(r));
  assert.equal(JSON.parse(old.writes[0]).type,'event');old.worker.stop();
});

test('transport budgets count UTF-8 and the incoming batch before accepting it', () => {
  const full=capturingTransport(true,4*1024*1024-1024);
  assert.equal(full.worker.write(deltaFrame(1)),false);assert.deepEqual(full.failures,['backpressure']);assert.equal(full.worker.deltas.length,0);
  const large=capturingTransport(false);
  assert.equal(large.worker.write({type:'event',op:'toolStart',detail:'中文'.repeat(250000)}),false);
  assert.deepEqual(large.failures,['frame_too_large']);assert.equal(large.worker.pending,'');
  const bad=capturingTransport();
  assert.equal(bad.worker.write({...deltaFrame(1),local:Array(10000).fill(0)}),false);
  assert.deepEqual(bad.failures,['bad_delta']);
  const extra=capturingTransport();extra.worker.write({...deltaFrame(1),unrecognised:'x'.repeat(1000000)});
  assert.equal(extra.worker.deltas[0].unrecognised,undefined);extra.worker.stop();
});

test('view requests coalesce: bursts, paced streams, unchanged views and idle watchdog', needsPython, async () => {
  const changes = [];
  const core = new ActivityCore({ onChange: paint => changes.push(paint), onFallback() {}, resolve: () => python, verify: true });
  try {
    assert.equal(await core.usePython(), undefined, core.failure);
    let requests = 0;
    const request = core.worker.request.bind(core.worker);
    core.worker.request = payload => { requests++; return request(payload); };
    const settle = async () => { await new Promise(r => setTimeout(r, 160)); await drained(core); };
    const start = Date.now();
    core.begin(start); core.turnStart(start);
    await settle(); requests = 0;
    // 1600 deltas in one tick: every event is sent, but only O(1) views are requested.
    let text = '';
    for (let i = 0; i < 1600; i++) { text += i % 200 ? 'x' : '\n⏵ 突发旁白'; core.delta('text_delta', text, Date.now()); }
    await settle();
    assert.ok(requests <= 3, `burst requested ${requests} views`);
    assert.equal(core.mismatches, 0);
    const at = Date.now(); core.requestView(at); await drained(core);
    assert.equal(core.line(at), core.ts.line(at), 'final view reflects every delta');
    // Paced stream: views follow the 120ms paint cadence, not the delta rate.
    requests = 0; const paced = Date.now();
    for (let i = 0; i < 60; i++) { core.delta('text_delta', text + i, Date.now()); await new Promise(r => setTimeout(r, 8)); }
    const elapsed = Date.now() - paced; await settle();
    assert.ok(requests <= Math.ceil(elapsed / 120) + 2, `${requests} views for 60 deltas over ${elapsed}ms`);
    // Urgent events still ask right away; unchanged replies do not repaint.
    changes.length = 0;
    core.toolStart('t', 'bash', { command: 'npm test' }, Date.now());
    await new Promise(r => setTimeout(r, 30)); await drained(core);
    assert.ok(core.line(Date.now()).includes('npm test')); assert.equal(changes.at(-1), 'soon');
    changes.length = 0; core.requestView(Date.now()); await drained(core);
    assert.deepEqual(changes, ['none'], 'same line/phase/dot: no repaint');
    // The watchdog only exists while a request is outstanding.
    await new Promise(r => setTimeout(r, 700));
    assert.equal(core.worker.timer, undefined, 'no idle watchdog timer');
    assert.equal(core.mismatches, 0);
  } finally { core.dispose(); }
});
