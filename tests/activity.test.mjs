import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ActivityState, FRAME_NAMES, PI_PRESET, normalizeActivity, restoreActivityConfig, extractNarration, mixSlot, pick, toolAction, narrationContract } from '../activity.ts';
import { PHRASES, FRAME_DATA } from '../data/activity/data.ts';
const start = new Date(2026, 3, 17, 12, 0, 0).getTime();
test('licensed data is unchanged from the mechanically extracted JSON; all 35 presets retained', () => {
  assert.deepEqual(PHRASES, JSON.parse(fs.readFileSync(new URL('../data/activity/phrases.json', import.meta.url), 'utf8')));
  assert.deepEqual(FRAME_DATA, JSON.parse(fs.readFileSync(new URL('../data/activity/frames.json', import.meta.url), 'utf8')));
  assert.equal(FRAME_NAMES.length, 36);
  assert.deepEqual(FRAME_NAMES.slice(0,35),Object.keys(FRAME_DATA.presets));
  assert.equal(FRAME_NAMES.at(-1),'pi');
  assert.deepEqual(FRAME_DATA.presets.moon8, { frames: ['🌑','🌒','🌓','🌔','🌕','🌖','🌗','🌘'], intervalMs: 120 });
  assert.ok(Object.values(FRAME_DATA.presets).some(preset => preset.frames.some(f => f.includes('\uFE0E'))));
  assert.equal(narrationContract('zh'), PHRASES.uiStrings.zh['narrate-instruction']);
  assert.equal(narrationContract('en'), PHRASES.uiStrings.en['narrate-instruction']);
});
test('moon frames advance at 120ms; render is pure; idle/done/off require no wake', () => {
  const a = new ActivityState({frames:'moon8'}); assert.equal(a.nextWakeAt(start), undefined); assert.equal(a.line(start), '🌑 ⏵ 待机中 · 等待任务');
  a.begin(start);
  for (let i = 0; i < 9; i++) {
    const now = start + i * 120;
    assert.ok(a.line(now).startsWith(FRAME_DATA.presets.moon8.frames[i % 8]));
    assert.equal(a.line(now), a.line(now)); assert.equal(a.nextWakeAt(now), Math.min(now + 120, start + (Math.floor((now - start) / 1000) + 1) * 1000));
  }
  a.finish(start + 2500); const summary = a.line(start + 2500);
  assert.equal(a.nextWakeAt(start + 2500), undefined); assert.equal(a.line(start + 20000), summary);
  a.configure({ enabled: false }); assert.equal(a.line(start), ''); assert.equal(a.nextWakeAt(start), undefined);
});
test('default π dots use a fixed five-column slot and stop completely in idle/done/off',()=>{
  const a=new ActivityState();assert.equal(a.config.frames,'pi');
  assert.equal(a.line(start),'π     ⏵ 待机中 · 等待任务');assert.equal(a.line(start),a.line(start+100000));
  assert.equal(a.nextWakeAt(start),undefined);a.begin(start);a.delta('text_delta','⏵ 验证点阵',start);
  for(let i=0;i<9;i++){
    const now=start+i*240,line=a.line(now);
    assert.equal(a.frame(now),PI_PRESET.frames[i%3]);assert.equal(a.frame(now).length,5);
    assert.equal(line.indexOf('⏵'),6,'narration never shifts as dot count changes');
    assert.equal(a.line(now),line);assert.ok(a.nextWakeAt(now)>now&&a.nextWakeAt(now)<=now+240);
  }
  a.finish(start+2510);const done=a.line(start+2510);
  assert.ok(done.startsWith('π     ⏵ 验证点阵'));assert.equal(a.frame(start+9999),'π    ');
  assert.equal(a.line(start+9999),done);assert.equal(a.nextWakeAt(start+9999),undefined);
  a.configure({enabled:false});assert.equal(a.line(start+9999),'');assert.equal(a.nextWakeAt(start+9999),undefined);
});
test('new π default preserves explicit moon preferences and legacy random slot selection',()=>{
  assert.equal(restoreActivityConfig([{type:'custom',customType:'pitools-activity-config',data:{schema:1,config:{frames:'moon8'}}}]).frames,'moon8');
  assert.equal(restoreActivityConfig([]).frames,'pi');
  const names=Object.keys(FRAME_DATA.presets),a=new ActivityState({frames:'random'});
  for(let i=0;i<100;i++){const now=start+i*999;a.begin(now);assert.equal(a.presetName,names[mixSlot(now,123)%names.length]);}
});
test('narration is line-start only, last match wins, bounded and sanitized', () => {
  assert.equal(extractNarration('some ⏵ inline marker'), undefined);
  assert.equal(extractNarration('⏵ 检查 README.MD\nnormal response'), '检查 README.MD');
  assert.equal(extractNarration('⏵ 第一件\n⏵ 第二件。后续句子'), '第二件');
  assert.equal(extractNarration('⏵ \x1b]52;c;PRIVATE\x07\x1b[31m检查\x1b[0m\t路径'), '检查 路径');
  assert.ok(extractNarration('⏵ ' + '中文'.repeat(50)).length <= 40);
  assert.equal(extractNarration('text' + '⏵ ' + 'a'.repeat(298)), undefined, 'buffer slicing must not invent a line boundary');
  assert.equal(extractNarration('⏵ \nempty'), undefined);
});
test('reasoning never narrates; text expires after 5s; stream start clears it', () => {
  const a = new ActivityState(); a.begin(start);
  a.delta('thinking_delta', '⏵ secret reasoning', start + 100);
  assert.equal(a.phase, 'thinking'); assert.equal(a.narration, '');
  a.delta('text_delta', '⏵ 验证补丁\nnormal response', start + 300);
  assert.ok(a.line(start + 5300).includes('⏵ 验证补丁'));
  assert.ok(!a.line(start + 5301).includes('⏵ 验证补丁'));
  a.streamStart(start + 6000); assert.equal(a.phase, 'waiting'); assert.equal(a.narration, '');
});
test('parallel tools end by ID; opening lasts 2500ms; failures still use the upstream check mark', () => {
  const a = new ActivityState(); a.begin(start);
  a.toolStart('a','bash',{command:'echo one'},start+100);
  a.toolStart('b','read',{path:'/tmp/two'},start+200);
  assert.equal(a.active.size,2); assert.ok(a.line(start+300).includes('2 并行'));
  a.toolEnd('a',false,start+800); assert.equal(a.phase,'tool'); assert.equal(a.active.size,1);
  a.toolEnd('b',true,start+900); assert.equal(a.phase,'thinking'); assert.equal(a.completed,2);
  assert.ok(a.line(start+1000).includes('✓')); assert.ok(!a.line(start+1000).includes('✗'));
  a.toolEnd('b',true,start+1100); assert.equal(a.completed,2);
  a.finish(start+2000); assert.ok(a.failure); assert.ok(a.line(start+2000).includes('2 工具'));
  assert.ok(PHRASES.fail.zh.some(p => a.doneText.startsWith(p)));
});
test('ordered language-specific tool actions, stable slots and tiers are preserved', () => {
  assert.equal(mixSlot(start,10),mixSlot(start,10));
  assert.equal(pick(PHRASES.waiting.zh,start,2),pick(PHRASES.waiting.zh,start,2));
  assert.ok(PHRASES.toolAction.zh.some(row => new RegExp(row.match.pattern,row.match.flags).test('ffgrep')));
  assert.ok(PHRASES.toolFallback.en.includes(toolAction('ffgrep','en',start,0)));
  const a = new ActivityState(); a.begin(start); a.delta('thinking_delta','',start);
  a.thinkingPhases = 2; // Bypass once-per-workflow greetings/rare eggs.
  const tier = PHRASES.thinkingTiers.zh.find(row => row.atMs===60000).pool;
  assert.ok(tier.includes(a.phrase(start+64000)));
});
test('preferences validate, restore current-branch metadata and remain independent of other UI', () => {
  assert.equal(normalizeActivity({frames:'__proto__',enabled:'false',lang:'xx'}).frames,'pi');
  assert.equal(normalizeActivity({frames:'random',lang:'en'}).frames,'random');
  const entries=[{type:'custom',customType:'unrelated',data:{config:{enabled:false}}},{type:'custom',customType:'pitools-activity-config',data:{schema:1,config:{frames:'dots',enabled:false}}}];
  const before=JSON.stringify(entries); const config=restoreActivityConfig(entries);
  assert.equal(config.enabled,false); assert.equal(JSON.stringify(entries),before);
  assert.equal(restoreActivityConfig([]).enabled,true);
});
test('done/aborted summaries stay static and count only supplied message output usage once', () => {
  const a=new ActivityState();a.begin(start);
  const message={content:[{type:'thinking',thinking:'⏵ private'},{type:'text',text:'⏵ 检查结果'}],usage:{output:12}};
  a.messageEnd(message,start+100);a.messageEnd(message,start+200);
  assert.equal(a.outputTokens,12);assert.equal(a.narration,'检查结果');
  a.finish(start+900,'aborted'); assert.ok(a.line(start+1000).includes('⏵ 检查结果 · 已中断'));
  const line=a.line(start+1000);a.finish(start+10000);assert.equal(a.line(start+10000),line);
  a.reset();assert.equal(a.line(start),'π     ⏵ 待机中 · 等待任务');assert.equal(a.nextWakeAt(start),undefined);
});
test('new sessions show static π; completion retains real narration and time without idle clocks', () => {
  const a=new ActivityState();
  const idle=a.line(start);assert.equal(idle,a.line(start+100000));
  assert.ok(!idle.includes('总')&&!idle.includes('0s'));assert.equal(a.nextWakeAt(start),undefined);
  a.begin(start);a.delta('text_delta','⏵ 修补边框',start+100);
  a.streamStart(start+500);assert.equal(a.narration,'');
  a.delta('text_delta','最后一条回复没有新旁白',start+800);a.finish(start+1210);
  assert.ok(a.line(start+1210).startsWith('π     ⏵ 修补边框 · '));
  assert.ok(a.line(start+1210).includes('总1s'));assert.equal(a.line(start+1210),a.line(start+100000));
  assert.equal(a.nextWakeAt(start+100000),undefined);
  a.configure({narrate:false});assert.ok(!a.line(start+2000).includes('修补边框'));
  a.reset({lang:'en'});assert.equal(a.line(start),'π     ⏵ Idle · ready for a task');
  assert.ok(!a.line(start).includes('修补边框'));assert.equal(a.nextWakeAt(start),undefined);
  a.configure({enabled:false});assert.equal(a.line(start),'');assert.equal(a.nextWakeAt(start),undefined);
});
