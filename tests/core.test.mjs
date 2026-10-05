import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TraceStore, safeText, duration, summary, contentText, emptyThinking, missingThinkingCount, validTimestamp, validModelTiming, timingInfo } from '../core.ts';
test('control sequences and bidi are removed, Chinese and line breaks preserved', () => {
  assert.equal(safeText('中文\x1b]52;secret\x07\u202eevil\nnext'), '中文]52;secretevil\nnext');
});
test('parallel calls pair by full ID, not completion order', () => {
  const s = new TraceStore();
  s.start('a', 'bash', { command: 'echo A' }, 10);
  s.start('b', 'read', { path: '/tmp/中文' }, 20);
  s.end('b', 'read', { content: 'B' }, false, 40);
  s.end('a', 'bash', { content: 'A' }, true, 100);
  assert.equal(s.calls.get('a').elapsed, 90);
  assert.equal(s.calls.get('b').elapsed, 20);
  assert.equal(s.calls.get('a').error, true);
  assert.equal(summary(s.calls.get('b')), '/tmp/中文');
});
test('replay gets full args/results and duration only from explicit metadata', () => {
  const s = new TraceStore();
  s.restore([
    { type: 'message', message: { role: 'user', content: 'hi' } },
    { type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', id: 'x', name: 'bash', arguments: { command: 'echo hello' } }] } },
    { type: 'message', message: { role: 'toolResult', toolCallId: 'x', toolName: 'bash', content: [{ type: 'text', text: 'hello' }], isError: false } },
  ]);
  assert.equal(s.calls.get('x').args.command, 'echo hello');
  assert.equal(duration(s.calls.get('x')), '历史耗时未知');
  s.restore([{ type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', id: 'x', name: 'bash', arguments: {} }] } }, { type: 'custom', customType: 'pitools-timing', data: { id: 'x', elapsed: 1234 } }]);
  assert.equal(duration(s.calls.get('x')), '1.23s');
  s.restore([]); assert.equal(s.calls.size, 0);
});
test('malformed content and unusual JSON scalars do not crash summaries', () => {
  assert.equal(contentText(null), '');
  assert.ok(contentText([null, { type: 'text', text: 'ok' }]).includes('ok'));
  assert.ok(contentText({ unexpected: true }).includes('unexpected'));
  assert.doesNotThrow(() => summary({ kind: 'tool', args: { value: 1n } }));
  assert.equal(duration({ live: true }), '历史耗时未知');
});
test('historical timing timestamps are restored only when valid', () => {
  const s = new TraceStore();
  s.restore([null, { type: 'message', message: null },
    { type: 'message', message: { role: 'assistant', content: [null, { type: 'toolCall', id: 'x', name: 'bash', arguments: {} }] } },
    { type: 'custom', customType: 'pitools-timing', data: { id: 'x', elapsed: 20, start: 100, end: 120 } }]);
  assert.equal(s.calls.get('x').start, 100);
  assert.equal(s.calls.get('x').end, 120);
  assert.equal(duration(s.calls.get('x')), '0.02s');
});
test('unknown completion amid a full parallel batch remains in the call map and ledger', () => {
  const s = new TraceStore(1);
  s.start('running', 'bash', {}, 10);
  s.end('unknown', 'read', {}, false, 20);
  assert.ok(s.records.includes(s.calls.get('unknown')));
  s.add({ kind: 'input' });
  assert.equal(s.calls.has('unknown'), false);
  assert.ok(s.records.includes(s.calls.get('running')));
});
test('empty thought detection ignores opaque signatures and sanitized whitespace', () => {
  const blocks = [
    { type: 'thinking', thinking: '', thinkingSignature: 'opaque-do-not-decode' },
    { type: 'thinking', thinking: ' \n\t\u200b\x1b', thinkingSignature: 'opaque' },
    { type: 'thinking', thinking: '真正可见的思考' },
    { type: 'text', text: '' },
  ];
  assert.equal(missingThinkingCount(blocks), 2);
  assert.equal(emptyThinking(blocks[2]), false);
  assert.equal(missingThinkingCount(null), 0);
  assert.equal(summary({ kind: 'model', name: '思考', live: true, text: '' }), '思考中…');
});
test('replay hides only empty thoughts, preserves usage and original transcript', () => {
  const entries = [{ type: 'message', message: { role: 'assistant', usage: { output: 42 }, content: [
    { type: 'thinking', thinking: '', thinkingSignature: 'opaque' },
    { type: 'thinking', thinking: '保留思考正文' },
    { type: 'text', text: '回复' },
    { type: 'toolCall', id: 'x', name: 'read', arguments: { path: '/tmp/x' } },
  ] } }];
  const before = JSON.stringify(entries);
  const s = new TraceStore(); s.restore(entries);
  assert.equal(s.hiddenThinking, 1);
  assert.equal(s.records.length, 3);
  assert.equal(s.records[0].text, '保留思考正文');
  assert.equal(s.records[1].usage.output, 42);
  assert.equal(s.calls.get('x').hiddenThinkingBlocks, 1);
  assert.equal(JSON.stringify(entries), before);
  s.restore([{ type: 'message', message: { role: 'assistant', content: [{ type: 'thinking', thinking: '', thinkingSignature: 'opaque' }] } }]);
  assert.equal(s.records.length, 0); assert.equal(s.hiddenThinking, 1);
  s.restore([]); assert.equal(s.hiddenThinking, 0);
});
test('removing a live placeholder does not count as history eviction', () => {
  const s = new TraceStore();
  const r = s.add({ kind: 'model', name: '思考', live: true, text: '' });
  s.remove(r); s.remove(r);
  assert.equal(s.records.length, 0); assert.equal(s.dropped, 0);
});
test('bounded retention does not evict running operations', () => {
  const s = new TraceStore(2);
  s.start('a', 'bash', {}, 1);
  s.add({ kind: 'input', text: 'first' });
  s.add({ kind: 'input', text: 'second' });
  assert.equal(s.records.length, 2); assert.ok(s.calls.has('a')); assert.equal(s.dropped, 1);
});
test('input time uses real message timestamp, then ISO entry time; never fabricates missing history', () => {
  const stamp = Date.parse('2026-10-04T10:00:00.123Z');
  const s = new TraceStore();
  s.restore([
    { type: 'message', timestamp: '2026-10-04T11:00:00.000Z', message: { role: 'user', content: 'a', timestamp: stamp } },
    { type: 'message', timestamp: '2026-10-04T12:00:00.000Z', message: { role: 'user', content: 'b', timestamp: NaN } },
    { type: 'message', message: { role: 'user', content: 'c' } },
  ]);
  assert.equal(s.records[0].recordedAt, stamp);
  assert.equal(s.records[0].recordedAtSource, 'message');
  assert.equal(s.records[1].recordedAt, Date.parse('2026-10-04T12:00:00.000Z'));
  assert.equal(s.records[1].recordedAtSource, 'entry');
  assert.equal(s.records[2].recordedAt, undefined);
  assert.deepEqual(Object.keys(timingInfo(s.records[0])), ['提交时间', '时间来源']);
  assert.ok(timingInfo(s.records[0]).提交时间.includes('.123 UTC'));
  assert.equal(timingInfo(s.records[2]).提交时间, '历史未记录提交时间');
});
test('timing fields distinguish input, tool, live model, and historical model', () => {
  const start = Date.parse('2026-10-04T10:00:00Z');
  const tool = timingInfo({ kind: 'tool', start, live: true }, start + 2500);
  assert.equal(tool.执行耗时, '2.50s（进行中）');
  assert.equal(tool.结束时间, '进行中');
  assert.ok(!Object.keys(tool).some(k => /内容事件|TTFT/.test(k)));
  const model = timingInfo({ kind: 'model', start, live: true, firstTokenMs: 500 }, start + 2500);
  assert.equal(model.首可见内容事件延迟_本地观测, '0.50s');
  assert.equal(model.首内容之后耗时_本地观测, '2.00s');
  assert.equal(model.总时长_助手消息整体, '2.50s（进行中）');
  const old = timingInfo({ kind: 'model', replay: true, messageAt: start });
  assert.equal(old.开始时间, '历史未记录');
  assert.ok(old.首可见内容事件延迟_本地观测.includes('无法恢复原始 TTFT'));
  assert.ok(old.会话消息时间戳_不冒充开始时间.includes('UTC'));
  assert.doesNotThrow(() => timingInfo({ kind: 'tool', start: Infinity, end: -1, elapsed: NaN }));
});
test('model timing binds by exact session entry ID, not shared timestamp or content', () => {
  const start = Date.parse('2026-10-04T10:00:00Z');
  const message = { role: 'assistant', timestamp: start, usage: { output: 20 }, content: [{ type: 'thinking', thinking: '相同思考' }, { type: 'text', text: '相同回复' }] };
  const entries = [
    { type: 'message', id: 'a', message },
    { type: 'message', id: 'b', message: structuredClone(message) },
    { type: 'message', id: 'c', message: structuredClone(message) },
    { type: 'custom', customType: 'pitools-model-timing', data: { messageEntryId: 'a', start, end: start + 5000, elapsed: 5000, firstTokenMs: 1000 } },
    { type: 'custom', customType: 'pitools-model-timing', data: { messageEntryId: 'b', start: start + 7000, end: start + 9000, elapsed: 2000, firstTokenMs: 250 } },
  ];
  const before = JSON.stringify(entries);
  const s = new TraceStore(); s.restore(entries);
  assert.equal(s.records[0].elapsed, 5000); assert.equal(s.records[1].elapsed, 5000);
  assert.equal(s.records[2].elapsed, 2000); assert.equal(s.records[3].firstTokenMs, 250);
  assert.equal(s.records[4].elapsed, undefined); assert.equal(s.records[4].firstTokenMs, undefined);
  assert.equal(s.records[0].timingSource, 'saved-local-observation');
  assert.equal(s.records[0].usage.output, 20);
  assert.equal(timingInfo(s.records[0]).首内容之后耗时_本地观测, '4.00s');
  assert.equal(JSON.stringify(entries), before);
  s.restore(entries.slice(0, 3));
  assert.ok(s.records.every(r => r.elapsed === undefined), 'timings outside the current branch cannot leak into replay');
});
test('invalid model timing and first-content values never become apparent measurements', () => {
  const start = Date.parse('2026-10-04T10:00:00Z');
  for (const d of [null, {}, { start, end: start - 1, elapsed: 1 }, { start: Infinity, end: start, elapsed: 1 }, { start, end: start + 1, elapsed: -1 }, { start, end: start + 1, elapsed: Infinity }, { start: new Date(start).toISOString(), end: new Date(start + 1).toISOString(), elapsed: 1 }]) assert.equal(validModelTiming(d), undefined);
  for (const firstTokenMs of [-1, Infinity, NaN, 1001, '100']) {
    const d = validModelTiming({ start, end: start + 1000, elapsed: 1000, firstTokenMs });
    assert.equal(d.elapsed, 1000); assert.equal(d.firstTokenMs, undefined);
  }
  assert.equal(validModelTiming({ start, end: start + 1000, elapsed: 1000, firstTokenMs: 0 }).firstTokenMs, 0);
  for (const t of [null, undefined, '', 'garbage', '42', 0, -1, Infinity, 8640000000000000]) assert.equal(validTimestamp(t), undefined);
});
