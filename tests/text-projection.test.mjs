import test from 'node:test';
import assert from 'node:assert/strict';
import { safeText, contentText, visibleTextTail, BlockTextCache } from '../core.ts';
import { extractNarration } from '../activity.ts';
const legacySafe = value => String(value ?? '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ').replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069]/g, '');
const fullVisible = blocks => blocks.filter(p => p?.type === 'text').map(p => p.text ?? '').join('\n');

test('safeText clean fast path is byte-for-byte equivalent to legacy replacement', () => {
  for (const v of ['', null, 42, '\r\n\r\t\n', '\x1b[31m', '中文🌗e\u0301', '\ud83d', '\ude00', ...Array.from({length:256}, (_, i)=>String.fromCharCode(i)), ...Array.from({length:200},(_,i)=>String.fromCharCode(0x2000+i))]) assert.equal(safeText(v), legacySafe(v));
  const large = 'clean 中文\n'.repeat(20000); assert.equal(safeText(large), legacySafe(large));
});

test('visible tail matches full join/slice across empty blocks, Unicode and controls', () => {
  const pieces = ['', '\r\n⏵ 检查\t文件', '🌗'.repeat(160), '\ud83d', '\ude00', '\x1b]52;x\x07', 'x'.repeat(320), '\n', '⏵ inline', '\u2028', null, 42];
  let n = 42; const rand = () => (n = (Math.imul(n,1664525)+1013904223)>>>0);
  for (let i=0;i<2000;i++) {
    const blocks = Array.from({length:rand()%12},()=>rand()%3 ? {type:'text',text:pieces[rand()%pieces.length]} : {type:'thinking',thinking:'private'});
    assert.equal(visibleTextTail(blocks), fullVisible(blocks).slice(-301));
    assert.equal(extractNarration(visibleTextTail(blocks)), extractNarration(fullVisible(blocks)));
  }
  assert.equal(visibleTextTail(undefined), '');
});

test('visible tail avoids reading irrelevant earlier text and never exposes thinking', () => {
  const earlier={type:'text', get text(){throw Error('earlier text should not be read');}};
  assert.equal(visibleTextTail([earlier,{type:'thinking',thinking:'⏵ SECRET'},{type:'text',text:'z'.repeat(1000000)}]),'z'.repeat(301));
});

test('block cache detects same-object edits/type changes and is cleared at boundaries', () => {
  const cache = new BlockTextCache(); const block={type:'text',text:'old\r\n\t中文'};
  assert.equal(cache.get(block),contentText([block])); assert.equal(cache.get(block), 'old\n    中文');
  block.text='new\x1b[31m'; assert.equal(cache.get(block),contentText([block]));
  block.type='thinking';block.thinking='fresh'; assert.equal(cache.get(block),'fresh');
  cache.clear(); assert.equal(cache.get(block),contentText([block]));
  const mutable={value:'a',toString(){return this.value;}};block.thinking=mutable;
  assert.equal(cache.get(block),'a');mutable.value='b';assert.equal(cache.get(block),'b');
});
