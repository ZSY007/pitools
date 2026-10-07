process.env.TZ = 'UTC';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ActivityCore, RustWorker, resolveRust, resolvePython, RUST_CORE_VERSION } from '../python-core.ts';
import { drive } from './activity-scenarios.mjs';

const rust = resolveRust(), python = resolvePython();
const native = {skip: rust ? false : 'set PITOOLS_RUST_CORE to an explicitly built trusted binary'};
const fake = {skip: python ? false : 'fault fixtures use Python; no interpreter found'};
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(check, message, timeout=6500) {
  const end=Date.now()+timeout;
  while (!check()) {if(Date.now()>end) throw new Error(message);await sleep(5);}
}
async function drained(core) {
  await until(() => {
    assert.ok(core.rust_active, `worker stopped: ${core.failure}`);
    return !core.expected.size && !core.worker.requests.size && !core.worker.deltas.length && !core.worker.pending && !core.viewTimer && !core.viewQueued && !core.inFlight;
  }, 'Rust views did not fully drain', 15000);
}
async function exited(child) {if(child && child.exitCode===null && !child.signalCode) await until(()=>child.exitCode!==null || child.signalCode, 'worker did not exit');}
function fixture(body) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(), 'pitools-rust-fault-'));
  const file=path.join(dir, 'worker.py');fs.writeFileSync(file, `import sys, json, time\n${body}\n`);
  return {command:{command:python.command,args:[...python.args,'-I','-B',file]},cleanup:()=>fs.promises.rm(dir,{recursive:true,force:true,maxRetries:40,retryDelay:50})};
}
const READY=`sys.stdin.readline()\nprint(json.dumps({'protocol':1,'type':'ready','version':'${RUST_CORE_VERSION}','core':'rust','rust':'fake','unicode':'${process.versions.unicode}','features':['event_batch']}),flush=True)\n`;

test('Rust resolver never builds, auto-searches PATH or resolves a session-relative binary', () => {
  assert.equal(resolveRust({PITOOLS_RUST_CORE:'./target/release/pitools-core'}), undefined);
  assert.equal(resolveRust({PITOOLS_RUST_CORE:'relative\\core.exe'}), undefined);
  assert.equal(resolveRust({PITOOLS_RUST_CORE:path.join(os.tmpdir(),'pitools-no-such-core')}),undefined);
  assert.equal(resolveRust({PATH:path.dirname(process.execPath)},process.platform,'unsupported'),undefined);
  assert.deepEqual(resolveRust({PITOOLS_RUST_CORE:process.execPath}),{command:process.execPath,args:[]});
});

test('missing Rust binary leaves authoritative TS state intact without automatic retry', async () => {
  const warnings=[];let resolutions=0;
  const core=new ActivityCore({onChange(){},onFallback:c=>warnings.push(c),resolveRust(){resolutions++;return undefined;}});
  core.begin(1700000000000);core.delta('text_delta','⏵ 保留旁白',1700000000010);
  const expected=core.ts.line(1700000000010);
  assert.equal(await core.useRust(),'rust_not_found');assert.equal(core.effective,'ts');
  for(let i=0;i<10;i++) assert.equal(core.line(1700000000010),expected);
  assert.equal(resolutions,1);assert.deepEqual(warnings,[]);assert.ok(core.status().includes('请求 Rust · 实际 TS'));
  core.dispose();
});

test('real Rust worker matches TS over randomized streams including lone UTF-16 units', native, async () => {
  const core=new ActivityCore({onChange(){},onFallback(){},resolveRust:()=>rust,verify:true});
  try {
    assert.equal(await core.useRust(),undefined,core.failure);
    assert.equal(core.effective,'rust');assert.equal(core.python_active,false);
    for(let seed=100;seed<160;seed++) {core.reset(seed%3?undefined:{lang:'en',frames:'random'});drive(core,seed,60);await drained(core);}
    assert.equal(core.mismatches,0);assert.ok(core.matches>3000,`compared ${core.matches}`);
  } finally {const child=core.worker?.child;core.dispose();await exited(child);}
});

test('mid-task Rust snapshot retains full tool IDs, lone surrogates and >512 message identities', native, async () => {
  const core=new ActivityCore({onChange(){},onFallback(){},resolveRust:()=>rust,verify:true});
  const now=1700000000000, messages=Array.from({length:600},()=>({content:[],usage:{output:1}}));
  core.begin(now);for(const message of messages) core.messageEnd(message,now+1);
  const idA='same-prefix-\ud800',idB='same-prefix-\ud801';
  core.toolStart(idA,'read',{path:'/tmp/\udfff'},now+2);core.toolStart(idB,'bash',{command:'echo \ud800'},now+3);
  try {
    assert.equal(await core.useRust(),undefined,core.failure);
    core.messageEnd(messages[0],now+4);core.toolEnd(idA,false,now+5);core.toolEnd(idB,true,now+6);
    core.delta('text_delta','⏵ 保留\ud800',now+7);core.finish(now+2000);
    core.requestView(now+2000);await drained(core);
    assert.equal(core.mismatches,0);assert.equal(core.line(now+2000),core.ts.line(now+2000));
    assert.ok(core.line(now+2000).includes('600 tokens'));assert.ok(core.line(now+2000).includes('\ud800'));
    assert.equal(core.ts.completed,2);assert.equal(core.failed,true);
    assert.equal(core.worker.timer,undefined);assert.equal(core.nextWakeAt(now+3000),undefined);
    const child=core.worker.child;core.useTs();await exited(child);assert.equal(core.effective,'ts');
  } finally {core.dispose();}
});

test('same timestamp on a new task cannot inherit prior message deduplication', native, async () => {
  const now=1700000000000,message={content:[],usage:{output:12}};
  const core=new ActivityCore({onChange(){},onFallback(){},resolveRust:()=>rust,verify:true});
  core.begin(now);core.messageEnd(message,now);core.finish(now+1);core.begin(now);
  try {assert.equal(await core.useRust(),undefined);core.messageEnd(message,now);core.finish(now+10);core.requestView(now+10);await drained(core);assert.equal(core.mismatches,0);assert.ok(core.line(now+10).includes('12 tokens'));}
  finally{const child=core.worker?.child;core.dispose();await exited(child);}
});

test('worker input budget falls back instead of truncating or colliding tool identities', native, async () => {
  const warnings=[],core=new ActivityCore({onChange(){},onFallback:c=>warnings.push(c),resolveRust:()=>rust});
  try {
    assert.equal(await core.useRust(),undefined);
    const id='x'.repeat(65536)+'A', now=Date.now();
    const child=core.worker.child;core.toolStart(id,'read',{path:'full-original'},now);
    assert.deepEqual(warnings,['text_too_large']);assert.equal(core.effective,'ts');
    assert.ok(core.ts.active.has(id));core.toolEnd(id,false,now+1);assert.equal(core.ts.completed,1);
    await exited(child);assert.equal(core.worker,undefined);
  } finally {core.dispose();}
});

test('switching Python → Rust → TS never creates idle or loses running tool state', {...native,skip:!rust||!python}, async () => {
  const core=new ActivityCore({onChange(){},onFallback(){},resolve:()=>python,resolveRust:()=>rust,verify:true});
  try {
    const now=Date.now();core.toolStart('parallel','bash',{command:'npm test'},now);
    assert.equal(await core.usePython(),undefined);const previous=core.worker.child;
    assert.equal(await core.useRust(),undefined);await exited(previous);
    core.requestView(now+1000);await drained(core);assert.equal(core.mismatches,0);assert.ok(core.line(now+1000).includes('npm test'));
    const child=core.worker.child;core.useTs();await exited(child);assert.equal(core.ts.active.size,1);assert.equal(core.phase,'tool');
  } finally{core.dispose();}
});

test('cancelled Rust startup settles promptly; old cancellation cannot clear a new Python startup', fake, async () => {
  const f=fixture('time.sleep(60)');
  const core=new ActivityCore({onChange(){},onFallback(){},resolve:()=>python,resolveRust:()=>f.command});
  let child;
  try {
    const first=core.useRust();child=core.worker.child;const second=core.usePython();
    assert.equal(await first,'stopped');assert.ok(core.starting);
    assert.equal(await second,undefined);assert.equal(core.effective,'python');await exited(child);
  } finally{const active=core.worker?.child;core.dispose();await exited(active);await f.cleanup();}
});

for(const [name,body,stage,category] of [
  ['version mismatch',"sys.stdin.readline()\nprint(json.dumps({'protocol':1,'type':'ready','version':'old','core':'rust','rust':'fake','unicode':'16.0'}),flush=True)\nsys.stdin.readline()",'start','handshake_failed'],
  ['Unicode mismatch',`sys.stdin.readline()\nprint(json.dumps({'protocol':1,'type':'ready','version':'${RUST_CORE_VERSION}','core':'rust','rust':'fake','unicode':'not-host'}),flush=True)\nsys.stdin.readline()`,'start','unicode_mismatch'],
  ['wrong worker kind',`sys.stdin.readline()\nprint(json.dumps({'protocol':1,'type':'ready','version':'${RUST_CORE_VERSION}','core':'python','python':'fake','unicode':'${process.versions.unicode}'}),flush=True)\nsys.stdin.readline()`,'start','handshake_failed'],
  ['exit before ready','sys.exit(1)','start','exited_before_ready'],
  ['crash after ready',READY+'sys.stdin.readline();sys.exit(1)','run','exited'],
  ['bad JSON',READY+'sys.stdin.readline();print("not json",flush=True);sys.stdin.readline()','run','bad_json'],
  ['bare WTF-8 bytes',READY+"sys.stdin.readline();sys.stdout.buffer.write(bytes([0xed,0xa0,0x80,10]));sys.stdout.buffer.flush();sys.stdin.readline()",'run','bad_utf8'],
  ['oversized Unicode frame',READY+"sys.stdin.readline();sys.stdout.buffer.write(('界'*400000+'\\n').encode('utf-8'));sys.stdout.buffer.flush();sys.stdin.readline()",'run','frame_too_large'],
  ['unsolicited view',READY+"sys.stdin.readline();print(json.dumps({'protocol':1,'type':'view','epoch':1,'id':999999,'line':'x','phase':'idle','failure':False,'live':False,'nextWakeAt':None}),flush=True);sys.stdin.readline()",'run','bad_view'],
  ['invalid error category is not echoed',READY+"sys.stdin.readline();print(json.dumps({'protocol':1,'type':'error','category':'\\x1b[31mPRIVATE TEXT'}),flush=True);sys.stdin.readline()",'run','unexpected_frame'],
  ['request timeout',READY+'while sys.stdin.readline():pass','run','request_timeout'],
]) {
  test(`Rust fault isolates process, preserves TS and cleans queues: ${name}`,fake,async()=>{
    const f=fixture(body),warnings=[];
    const core=new ActivityCore({onChange(){},onFallback:c=>warnings.push(c),resolveRust:()=>f.command,verify:true});
    core.begin(1700000000000);core.delta('text_delta','⏵ 原始状态仍在',1700000000001);
    let child;
    try {
      const promise=core.useRust();child=core.worker.child;const failure=await promise;
      if(stage==='start'){assert.equal(failure,category);assert.deepEqual(warnings,[]);}
      else{assert.equal(failure,undefined);core.requestView(Date.now());await until(()=>warnings.length,`missing ${category}`);assert.deepEqual(warnings,[category]);}
      assert.equal(core.effective,'ts');assert.equal(core.line(1700000000001),core.ts.line(1700000000001));
      assert.equal(core.worker,undefined);assert.equal(core.viewTimer,undefined);assert.equal(core.inFlight,0);assert.equal(core.expected.size,0);
      await exited(child);await sleep(30);assert.equal(warnings.length,stage==='run'?1:0);
    } finally{core.dispose();await exited(child);await f.cleanup();}
  });
}

test('Rust framing keeps bounded ordered delta batches and clears their deadline on shutdown',()=>{
  const writes=[],errors=[],worker=new RustWorker(()=>{},e=>errors.push(e));
  worker.batchEvents=true;worker.child={removeAllListeners(){},kill(){},stdin:{writableLength:0,write:s=>writes.push(s),end(){},removeAllListeners(){},on(){}}};
  for(let seq=1;seq<=64;seq++)worker.write({type:'event',op:'delta',epoch:1,seq,now:seq,local:[2026,4,17,5,12],kind:'text_delta',text:'⏵ \ud800'});
  worker.flush();const batch=JSON.parse(writes.join(''));assert.equal(batch.type,'event_batch');assert.equal(batch.events.length,64);
  assert.deepEqual(batch.events.map(e=>e.seq),Array.from({length:64},(_,i)=>i+1));assert.deepEqual(errors,[]);
  worker.stop();assert.equal(worker.batchTimer,undefined);assert.equal(worker.pending,'');assert.equal(worker.deltas.length,0);
});
