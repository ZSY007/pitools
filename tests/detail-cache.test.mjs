import test from 'node:test';
import assert from 'node:assert/strict';
import { DetailCache, TraceStore } from '../core.ts';

test('detail cache is lazy and hits only an identical content/layout/theme key', () => {
  const cache = new DetailCache(), record = {}; let builds = 0;
  const build = () => { builds++; return ['full content']; };
  const key = [record, 0, 2, 80, false, 'dark'];
  const lines = cache.render(key, build);
  assert.equal(cache.render([...key], build), lines); assert.equal(builds, 1);
  for (const changed of [[{}, 0, 2, 80, false, 'dark'], [record, 1, 2, 80, false, 'dark'], [record, 1, 1, 80, false, 'dark'], [record, 1, 1, 100, false, 'dark'], [record, 1, 1, 100, true, 'dark'], [record, 1, 1, 100, true, 'light']]) cache.render(changed, build);
  assert.equal(builds, 7); assert.ok(cache.bytes <= cache.maxBytes);
});

test('oversized lines are returned complete but not retained; miss clears old record', () => {
  const cache = new DetailCache(1024), old = {};
  cache.render([old], () => ['small']); assert.ok(cache.key);
  const large = ['全文' + 'x'.repeat(2000), '尾部完整']; let builds = 0;
  const build = () => { builds++; return large; };
  assert.equal(cache.render(['large'], build), large);
  assert.equal(cache.key, undefined); assert.equal(cache.lines, undefined); assert.equal(cache.bytes, 0);
  cache.render(['large'], build); assert.equal(builds, 2);
});

test('line overhead and key strings count against budget; zero budget never retains', () => {
  const cache = new DetailCache(1024);
  const lines = Array(100).fill('');
  assert.equal(cache.render(['x'], () => lines), lines); assert.equal(cache.bytes, 0);
  cache.render(['x'.repeat(600)], () => []); assert.equal(cache.bytes, 0);
  const zero = new DetailCache(0); const full = ['kept in view, not in cache'];
  assert.equal(zero.render([1], () => full), full); assert.equal(zero.lines, undefined);
});

test('invalidate/dispose clear retained lines, and failed builds never expose an old hit', () => {
  const cache = new DetailCache(); cache.render(['old'], () => ['old']);
  assert.throws(() => cache.render(['new'], () => { throw Error('render failure'); }));
  assert.equal(cache.key, undefined); assert.equal(cache.bytes, 0);
  cache.render(['new'], () => ['new']); cache.clear(); cache.clear();
  assert.equal(cache.lines, undefined); assert.equal(cache.bytes, 0);
});

test('store revisions advance on start/end and explicit same-object updates', () => {
  const store = new TraceStore(); const r = store.start('id', 'bash', { command: 'echo' }, 1000);
  const initial = r.revision; assert.ok(initial > 0);
  const result = { content: [{ type: 'text', text: 'old' }] };
  store.end('id', 'bash', result, false, 2000); assert.ok(r.revision > initial);
  const ended = r.revision; result.content[0].text = 'new'; store.touch(r);
  assert.ok(r.revision > ended); assert.equal(r.result, result);
});
