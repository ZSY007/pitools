// Deterministic activity scenarios for TS ↔ Python parity. Drives the real
// ActivityCore facade with a capturing fake worker, so the recorded frames are
// exactly what the host would send and the expectations are the TS core's view.
import { ActivityCore } from '../python-core.ts';
import { PHRASES, FRAME_DATA } from '../data/activity/data.ts';
import { mixSlot, FRAME_NAMES } from '../activity.ts';

function prng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const toolNames = ['read', 'Read', 'bash', 'functions.bash', 'tools.grep', 'ffgrep', 'fffind', 'web_search', 'search-layer', 'mcp__x', 'GitHub', 'chrome_devtools', 'todo_write', 'unknown_tool', 'ſearch', 'Kead', 'READ\u212a', '', '  edit  ', '工具'];
const pieces = ['⏵ 检查 README.MD', '⏵ inspect the patch. Then more', '⏵ 第一件\n⏵ 第二件。后续', 'plain reply ', '\n', '⏵ \x1b]52;c;SECRET\x07\x1b[31m红色\x1b[0m\t路径', '🌗🧑‍💻 emoji ', '\ud83d', '\ude00', 'e\u0301', '中文'.repeat(30), 'x'.repeat(120), '⏵ ' + '宽'.repeat(60), ' inline ⏵ marker', '\r\n⏵ crlf line', '\u2028⏵ ls', '⏵ a.b c.D', '⏵ Mr.Smith', '⏵ end.', '\ufeff⏵ bom'];
const details = [{ command: 'echo "中文"\nprintf 42' }, { path: '/tmp/中文路径/文件.txt' }, { file_path: 'C:\\Users\\x\\a.ts' }, { query: 'search   terms\t\there' }, { url: 'https://example.com/' + 'p'.repeat(80) }, { command: 42 }, {}, undefined, { path: '\x1b[31mred\x1b[0m' }, { command: '🧑‍💻'.repeat(30) }];
const presets = FRAME_NAMES;
const lunar = Object.keys(PHRASES.lunarNewYearDays);
const holidays = Object.keys(PHRASES.holiday.zh);

export function rareSeed(from) {
  for (let t = from; ; t++) if (mixSlot(t, 0x5EED) % 150 === 0) return t;
}

function startTime(rand, index) {
  const pick = index % 6;
  const hour = Math.floor(rand() * 24), minute = Math.floor(rand() * 60);
  if (pick === 0) { const [y, m, d] = lunar[Math.floor(rand() * lunar.length)].split('-').map(Number); return Date.UTC(y, m - 1, d, hour, minute); }
  if (pick === 1) { const [m, d] = holidays[Math.floor(rand() * holidays.length)].split('-').map(Number); return Date.UTC(2026, m - 1, d, hour, minute); }
  if (pick === 2) return rareSeed(Date.UTC(2026, 3, 17, 12) + Math.floor(rand() * 1e7));
  if (pick === 3) return Date.UTC(2026, 9, 3 + Math.floor(rand() * 2), Math.floor(rand() * 6), minute); // weekend / night
  return Date.UTC(2024 + Math.floor(rand() * 4), Math.floor(rand() * 12), 1 + Math.floor(rand() * 28), hour, minute) + Math.floor(rand() * 1000);
}

/** Returns { locale, frames: [...protocol frames], expect: { [viewId]: [line, phase, failure, live, nextWakeAt] } }. */
export function scenario(seed, steps = 40, locale = 'zh-CN') {
  const frames = [];
  const fake = { closed: false, write(payload) { frames.push(JSON.parse(JSON.stringify({ protocol: 1, ...payload }))); return true; }, request(payload) { this.write({ type: 'view', ...payload }); } };
  const core = new ActivityCore({ onChange() {}, onFallback() {}, locale: () => locale, verify: true });
  core.worker = fake; core.queueView = () => {};
  core.epoch = 1; frames.push({ protocol: 1, type: 'event', epoch: 1, seq: 0, op: 'snapshot', state: (() => { const s = core.ts.snapshot(); s.startedLocal = [1970, 1, 1, 4, 0]; s.seenMessageKeys = []; return s; })() });
  drive(core, seed, steps);
  const expect = {};
  for (const [id, value] of core.expected) expect[id] = JSON.parse(value);
  return { seed, locale, frames, expect };
}

/** Random but seeded host calls on any ActivityCore, with view requests after each step. */
export function drive(core, seed, steps = 40) {
  const rand = prng(seed);
  let now = startTime(rand, seed);
  const messages = [];
  const ids = [];
  const choose = list => list[Math.floor(rand() * list.length)];
  for (let i = 0; i < steps; i++) {
    const r = rand();
    if (r < 0.06) core.begin(now);
    else if (r < 0.12) core.turnStart(now);
    else if (r < 0.2) core.streamStart(now);
    else if (r < 0.42) {
      let text = ''; for (let n = Math.floor(rand() * 5); n >= 0; n--) text += choose(pieces);
      core.delta(rand() < 0.75 ? 'text_delta' : 'thinking_delta', text, now);
    } else if (r < 0.52) {
      let message = rand() < 0.3 && messages.length ? choose(messages) : undefined;
      if (!message) {
        const output = choose([12, 0, 999, 1000, 1250, 1350, 2049, 12.5, NaN, -3, '40', undefined, 123456]);
        message = { content: [{ type: 'thinking', thinking: '⏵ private' }, { type: 'text', text: choose(pieces) + choose(pieces) }], usage: output === undefined ? undefined : { output } };
        messages.push(message);
      }
      core.messageEnd(message, now);
    } else if (r < 0.68) {
      const id = rand() < 0.2 && ids.length ? choose(ids) : `call-${seed}-${i}`;
      ids.push(id);
      core.toolStart(id, choose(toolNames), choose(details), now);
    } else if (r < 0.8) core.toolEnd(rand() < 0.85 && ids.length ? choose(ids) : 'unknown', rand() < 0.3, now);
    else if (r < 0.86) core.finish(now, choose(['', '', 'aborted', 'error', 'stop']));
    else if (r < 0.93) {
      const config = { ...core.config };
      const key = choose(['frames', 'lang', 'narrate', 'phrases', 'enabled', 'contract']);
      if (key === 'frames') config.frames = rand() < 0.3 ? 'random' : choose(presets);
      else if (key === 'lang') config.lang = choose(['zh', 'en']);
      else config[key] = rand() < (key === 'enabled' ? 0.85 : 0.5);
      core.configure(config);
    } else if (r < 0.95) core.reset(rand() < 0.5 ? undefined : { lang: choose(['zh', 'en']), frames: choose(presets) });
    else core.turnStart(now);
    for (let v = 1 + Math.floor(rand() * 3); v > 0; v--) core.requestView(now + choose([0, 1, 119, 120, 999, 1000, 2499, 2500, 3999, 4000, 5000, 5001, 7500, 31000, 61000, 301000]));
    now += choose([0, 1, 50, 120, 500, 1000, 2500, 4000, 5001, 9000, 30000, 70000]);
  }
  return now;
}
