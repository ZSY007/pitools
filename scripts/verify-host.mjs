import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import assert from 'node:assert/strict';
const host = process.env.PI_HOST_ROOT;
if (!host) throw new Error('Set PI_HOST_ROOT to the installed @earendil-works/pi-coding-agent directory.');
const { loadExtensions } = await import(pathToFileURL(path.join(host, 'dist/core/extensions/loader.js')));
const bundle = process.env.PI_BUNDLED_LOADER === '1' ? await import(pathToFileURL(path.join(host, 'dist/bundle/index.js'))) : undefined;
const hostRequire = createRequire(path.join(host, 'package.json'));
const { visibleWidth, TuiMainScreen, TuiAltScreen } = await import(pathToFileURL(hostRequire.resolve('@earendil-works/pi-tui')));
const { loadThemeFromPath, getThemeByName, setThemeInstance } = await import(pathToFileURL(path.join(host, 'dist/modes/interactive/theme/theme.js')));
const entry = process.env.PI_EXTENSION_ENTRY ?? fileURLToPath(new URL('../index.ts', import.meta.url));
const strip = s => s.replace(/\x1b\[[0-9;]*m/g, '');
async function verify(themeName, mode) {
  const isolated = bundle ? fs.mkdtempSync(path.join(os.tmpdir(), 'pitools-bundle-')) : undefined;
  const loaded = bundle
    ? await bundle.discoverAndLoadExtensions([entry], isolated, path.join(isolated, 'agent'))
    : await loadExtensions([entry], process.cwd());
  assert.deepEqual(loaded.errors, []);
  const ext = loaded.extensions[0], persisted = [], notifications = [];
  loaded.runtime.appendEntry = (type, data) => persisted.push({ type, data });
  loaded.runtime.getAllTools = () => [{ name: 'bash', description: 'Run shell', parameters: { type: 'object', properties: { command: { type: 'string' } } } }];
  for (const key of ['alt+,', 'alt+.', 'alt+i', 'alt+t']) assert.ok(ext.shortcuts.has(key));
  // Both actual Theme methods and the global theme used by Pi's Markdown and
  // syntax highlighter are real, strict host objects, not permissive stubs.
  const theme = themeName === 'system' ? getThemeByName('system') : loadThemeFromPath(path.join(host, 'dist/modes/interactive/theme', `${themeName}.json`), mode);
  assert.ok(theme); setThemeInstance(theme);
  let widget, inspector;
  const tui = { terminal: { rows: 30 }, requestRender() {} };
  const ctx = { mode: 'tui', hasUI: true, sessionManager: { getBranch() { return []; } }, ui: {
    setWidget(_name, factory) { widget?.dispose?.(); widget = factory?.(tui, theme); },
    notify(text, level) { notifications.push({ text, level }); },
    custom(factory) { return new Promise(resolve => {
      let closed = false;
      inspector = factory(tui, theme, {}, () => { if (closed) return; closed = true; inspector?.dispose?.(); resolve(); });
      inspector.focused = true;
    }); },
  } };
  const emit = async (name, event = {}) => { for (const fn of ext.handlers.get(name) ?? []) await fn(event, ctx); };
  const command = args => ext.commands.get('pitools').handler(args, ctx);
  function widths(component) {
    for (const w of [1, 8, 20, 80, 100, 160]) for (const line of component.render(w)) assert.ok(visibleWidth(line) <= w, `overflow ${w}: ${line}`);
    assert.deepEqual(component.render(0), []);
  }
  try {
    await emit('session_start'); widths(widget);
    const freshHeader = strip(widget.render(160)[0]);
    assert.ok(freshHeader.startsWith('● 🌑 ⏵ 待机中'), 'fresh Pi sessions must show the idle activity');
    assert.ok(!freshHeader.includes('总0s'), 'do not fabricate task timing before any task');
    await emit('message_start', { message: { role: 'user', content: '检查中文路径' } });
    const assistant = { role: 'assistant', content: [{ type: 'thinking', thinking: '初始思考' }, { type: 'text', text: '初始回复' }, { type: 'thinking', thinking: '后续思考' }], usage: { input: 10, output: 20, totalTokens: 30 } };
    await emit('message_start', { message: assistant });
    await emit('message_update', { message: assistant, assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0 } });
    await emit('message_update', { message: assistant, assistantMessageEvent: { type: 'text_delta', contentIndex: 1 } });
    assistant.content[1].text = '最终回复\n```python\nprint("中文")\n```';
    await emit('message_end', { message: assistant });
    assert.ok(strip(widget.render(160)[0]).includes('4 个事件'), 'each content block must appear exactly once');
    await command('prev'); assert.ok(strip(widget.render(160).join('\n')).includes('最终回复'), 'finalized text must replace the streamed prefix');
    await command('live');
    await emit('tool_execution_start', { toolCallId: 'a', toolName: 'bash', args: { command: 'echo "中文"\nprintf "%s" 42' } });
    await emit('tool_execution_update', { toolCallId: 'a', partialResult: { content: [{ type: 'text', text: 'stream' }] } });
    await emit('tool_execution_end', { toolCallId: 'a', toolName: 'bash', result: { content: [{ type: 'text', text: '```python\nprint(42)\n```\n\x1b]52;bad\x07' }] }, isError: false });
    assert.equal(persisted[0].type, 'pitools-timing'); assert.equal(persisted[0].data.id, 'a'); assert.ok(persisted[0].data.elapsed >= 0);
    widths(widget);
    const pending = command(''); assert.ok(inspector);
    widths(inspector);
    inspector.handleInput('\t'); // command / full arguments
    let codeView = inspector.render(80).join('\n');
    assert.ok(strip(codeView).includes('命令 · bash'));
    assert.ok(strip(codeView).includes('echo "中文"'));
    assert.ok(codeView.includes(theme.fg('syntaxString', '"中文"')), 'shell command must have real syntax highlighting');
    inspector.handleInput('r');
    assert.ok(!strip(inspector.render(80).join('\n')).includes('命令 · bash'), 'raw mode must show the original JSON');
    inspector.handleInput('r'); inspector.handleInput('\t'); // result
    const renderedOutput = inspector.render(80).join('\n');
    assert.ok(!renderedOutput.includes('\x1b]52;'));
    assert.ok(strip(renderedOutput).includes('print(42)'), 'fenced Python output should be rendered');
    for (let n = 0; n < 5; n++) { inspector.handleInput('\t'); widths(inspector); }
    inspector.handleInput('/'); inspector.handleInput('zz-no-matches');
    assert.ok(strip(inspector.render(80).join('\n')).includes('没有匹配事件'));
    // Editing in the middle must not reset Input's cursor to the end.
    inspector.handleInput('\x1b'); inspector.handleInput('/');
    inspector.handleInput('\x01'); // Home (ctrl+a)
    inspector.handleInput('bash'); widths(inspector);
    inspector.focused = false;
    assert.ok(!inspector.render(80).join('\n').includes('\x1b_pi:c'), 'unfocused search should not emit a cursor marker');
    inspector.focused = true; inspector.handleInput('\r');
    for (const rows of [1, 5, 11, 12, 16, 30, 60]) { tui.terminal.rows = rows; widths(inspector); assert.ok(inspector.render(80).length <= rows); }
    tui.terminal.rows = 30;
    inspector.handleInput('\x1b'); await pending;
    // Hide and show while new events arrive: observation is not disabled.
    await ext.shortcuts.get('alt+t').handler(ctx); assert.equal(widget, undefined);
    await emit('message_start', { message: { role: 'user', content: 'hidden event' } });
    await command('toggle'); await command('live'); assert.ok(strip(widget.render(80).join('\n')).includes('hidden event'));
    // Empty/signature-only reasoning: live placeholder, final removal, notes,
    // interrupted cleanup, and historical replay all use the same policy.
    const onlyEmpty = { role: 'assistant', content: [{ type: 'thinking', thinking: '', thinkingSignature: 'opaque' }] };
    await command('live');
    await emit('message_start', { message: onlyEmpty });
    await emit('message_update', { message: onlyEmpty, assistantMessageEvent: { type: 'thinking_start', contentIndex: 0 } });
    assert.ok(strip(widget.render(160).join('\n')).includes('思考中…'));
    const emptyPending = command(''); inspector.handleInput('\t');
    assert.ok(strip(inspector.render(80).join('\n')).includes('思考中…'), 'preview should not show a blank live thought');
    await emit('message_end', { message: onlyEmpty });
    assert.ok(!strip(widget.render(160).join('\n')).includes('思考中…'));
    assert.ok(strip(widget.render(160)[0]).includes('已收起 1 个空思考'));
    widths(inspector); inspector.handleInput('\x1b'); await emptyPending;
    const hiddenAndTool = { role: 'assistant', content: [
      { type: 'thinking', thinking: '', thinkingSignature: 'opaque' },
      { type: 'text', text: 'visible final reply' },
      { type: 'toolCall', id: 'reasoning-call', name: 'bash', arguments: { command: 'echo 1' } },
    ], usage: { output: 33 } };
    await emit('message_start', { message: hiddenAndTool });
    await emit('message_update', { message: hiddenAndTool, assistantMessageEvent: { type: 'text_delta', contentIndex: 1 } });
    assert.ok(!strip(widget.render(160).join('\n')).includes('思考中…'), 'text delta must not create a signed-only thought placeholder');
    await emit('message_end', { message: hiddenAndTool });
    await emit('tool_execution_start', { toolCallId: 'reasoning-call', toolName: 'bash', args: { command: 'echo 1' } });
    await command('live');
    const notePending = command('');
    assert.ok(strip(inspector.render(160).join('\n')).includes('未提供可见思考'));
    inspector.handleInput('\x1b'); await notePending;
    await emit('tool_execution_end', { toolCallId: 'reasoning-call', toolName: 'bash', result: { content: [] }, isError: false });
    await emit('message_start', { message: onlyEmpty });
    await emit('message_update', { message: onlyEmpty, assistantMessageEvent: { type: 'thinking_start', contentIndex: 0 } });
    await emit('agent_end');
    assert.ok(!strip(widget.render(160).join('\n')).includes('思考中…'), 'interruption must clean up empty placeholders');
    // A finalized nonempty thought must not be mistaken for a placeholder.
    await command('live');
    const becomesVisible = { role: 'assistant', content: [{ type: 'thinking', thinking: '' }] };
    await emit('message_start', { message: becomesVisible });
    await emit('message_update', { message: becomesVisible, assistantMessageEvent: { type: 'thinking_start', contentIndex: 0 } });
    becomesVisible.content[0].thinking = 'retained visible reasoning';
    await emit('message_end', { message: becomesVisible });
    assert.ok(strip(widget.render(160).join('\n')).includes('retained visible reasoning'));
    // Timing regression: exact deterministic clock, real renderer, persisted
    // message IDs, reload recovery, abort fallback, and no historical guessing.
    const realNow = Date.now, t0 = Date.parse('2026-10-04T10:00:00Z');
    let clock = t0;
    const timingBranch = [];
    const modelCount = () => persisted.filter(p => p.type === 'pitools-model-timing').length;
    ctx.sessionManager.getBranch = () => timingBranch;
    await emit('session_tree');
    Date.now = () => clock;
    try {
      const input = { role: 'user', content: 'timing-input', timestamp: t0 - 875 };
      await emit('message_start', { message: input });
      timingBranch.push({ type: 'message', id: 'timing-input', message: input });
      const inputPending = command('');
      let view = strip(inspector.render(160).join('\n'));
      assert.ok(view.includes('提交时间') && view.includes('.125 UTC'));
      assert.ok(!view.includes('Token（') && !view.includes('首可见内容事件') && !view.includes('执行耗时'), 'inputs must not pretend to be executions');
      for (let i = 0; i < 3; i++) inspector.handleInput('\t');
      assert.ok(strip(inspector.render(160).join('\n')).includes('[计时]'));
      inspector.handleInput('\x1b'); await inputPending;
      const timed = { role: 'assistant', timestamp: t0, content: [
        { type: 'thinking', thinking: '', thinkingSignature: 'opaque' },
        { type: 'text', text: '' },
        { type: 'toolCall', id: 'timed-call', name: 'bash', arguments: { command: 'echo timed' } },
      ], usage: { output: 8 } };
      await emit('message_start', { message: timed });
      clock = t0 + 200;
      await emit('message_update', { message: timed, assistantMessageEvent: { type: 'thinking_start', contentIndex: 0 } });
      clock = t0 + 500;
      await emit('message_update', { message: timed, assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: ' \n' } });
      clock = t0 + 800; timed.content[1].text = 'timed final reply';
      await emit('message_update', { message: timed, assistantMessageEvent: { type: 'text_delta', contentIndex: 1, delta: 'timed final reply' } });
      await command('live');
      const livePending = command('');
      for (let i = 0; i < 3; i++) inspector.handleInput('\t');
      clock = t0 + 3200;
      view = strip(inspector.render(160).join('\n'));
      assert.ok(view.includes('0.80s') && view.includes('3.20s（进行中）'), 'live first-content delay and elapsed time should update before completion');
      await emit('message_end', { message: timed });
      inspector.handleInput('\x1b'); await livePending;
      const before = modelCount();
      assert.equal(before, 0, 'message_end has no stable entry ID yet');
      timingBranch.push({ type: 'message', id: 'timed-model', message: timed });
      clock = t0 + 4000;
      await emit('tool_execution_start', { toolCallId: 'timed-call', toolName: 'bash', args: { command: 'echo timed' } });
      clock = t0 + 5500;
      await emit('tool_execution_end', { toolCallId: 'timed-call', toolName: 'bash', result: { content: [{ type: 'text', text: 'timed' }] }, isError: false });
      const toolTiming = persisted.find(p => p.type === 'pitools-timing' && p.data.id === 'timed-call');
      assert.equal(toolTiming.data.elapsed, 1500);
      timingBranch.push({ type: 'custom', customType: toolTiming.type, data: toolTiming.data },
        { type: 'message', id: 'timed-result', message: { role: 'toolResult', toolCallId: 'timed-call', toolName: 'bash', content: [{ type: 'text', text: 'timed' }] } });
      await command('live');
      const toolPending = command('');
      for (let i = 0; i < 4; i++) inspector.handleInput('\t');
      view = strip(inspector.render(160).join('\n'));
      assert.ok(view.includes('执行耗时') && view.includes('1.50s'));
      assert.ok(!view.includes('首可见内容事件'), 'tool timing must not expose model TTFT');
      inspector.handleInput('\x1b'); await toolPending;
      clock = t0 + 9000;
      await emit('turn_end', { message: structuredClone(timed), messageEntryId: 'wrong-object' });
      assert.equal(modelCount(), before, 'equal text/timestamp is not sufficient identity');
      await emit('turn_end', { message: timed, messageEntryId: 'timed-model' });
      await emit('turn_end', { message: timed, messageEntryId: 'timed-model' });
      assert.equal(modelCount(), before + 1, 'one metadata entry per assistant message');
      const saved = persisted.find(p => p.type === 'pitools-model-timing' && p.data.messageEntryId === 'timed-model');
      assert.equal(saved.data.start, t0); assert.equal(saved.data.end, t0 + 3200);
      assert.equal(saved.data.elapsed, 3200); assert.equal(saved.data.firstTokenMs, 800);
      assert.deepEqual(Object.keys(saved.data).sort(), ['schema', 'messageEntryId', 'start', 'end', 'elapsed', 'firstTokenMs'].sort(), 'metadata must not duplicate message bodies or usage');
      timingBranch.push({ type: 'custom', customType: saved.type, data: saved.data });
      await emit('session_tree'); await command('prev');
      const replayPending = command('');
      for (let i = 0; i < 3; i++) inspector.handleInput('\t');
      view = strip(inspector.render(160).join('\n'));
      assert.ok(view.includes('3.20s') && view.includes('0.80s') && view.includes('2.40s') && view.includes('保存的本地消息观测'), 'replay must restore all saved model metrics');
      widths(inspector); inspector.handleInput('\x1b'); await replayPending;
      // Aborted final message without turn_end still gets its exact persisted ID.
      const aborted = { role: 'assistant', timestamp: t0, stopReason: 'aborted', content: [{ type: 'text', text: 'aborted reply' }] };
      clock = t0 + 10000; await emit('message_start', { message: aborted });
      clock = t0 + 12000; await emit('message_end', { message: aborted });
      timingBranch.push({ type: 'message', id: 'aborted-model', message: aborted });
      await emit('agent_end');
      const abortSaved = persisted.find(p => p.type === 'pitools-model-timing' && p.data.messageEntryId === 'aborted-model');
      assert.equal(abortSaved.data.elapsed, 2000); assert.equal(abortSaved.data.firstTokenMs, undefined);
      assert.equal(modelCount(), before + 2);
      // Never borrow the previous model's clock or match a cloned transcript.
      const endOnly = { role: 'assistant', content: [{ type: 'text', text: 'message-end only' }] };
      clock = t0 + 14000; await emit('message_end', { message: endOnly });
      timingBranch.push({ type: 'message', id: 'end-only', message: endOnly });
      await emit('agent_end'); assert.equal(modelCount(), before + 2);
      const unbound = { role: 'assistant', timestamp: t0, content: [{ type: 'text', text: 'aborted reply' }] };
      await emit('message_start', { message: unbound });
      clock = t0 + 15000; await emit('message_end', { message: unbound });
      timingBranch.push({ type: 'message', id: 'cloned-unbound', message: structuredClone(unbound) });
      await emit('agent_end'); assert.equal(modelCount(), before + 2);
    } finally { Date.now = realNow; }
    // Integrated left-first activity and uniform header color, prompt ownership, live-only clocks,
    // frame switching, preference replay, and non-TUI behavior.
    ctx.sessionManager.getBranch = () => [];
    await emit('session_tree');
    assert.ok(!ext.commands.has('activity'), 'do not collide with another plugin\'s global /activity command');
    const originalSetTimeout = globalThis.setTimeout, originalClearTimeout = globalThis.clearTimeout;
    const scheduled = new Set();
    globalThis.setTimeout = (fn, delay) => { const handle = { fn, delay, unref() {} }; scheduled.add(handle); return handle; };
    globalThis.clearTimeout = handle => scheduled.delete(handle);
    try {
      assert.equal(scheduled.size, 0);
      const prompt = { systemPromptOptions: { sections: { other_plugin: 'preserved' } } };
      await emit('before_agent_start', prompt);
      assert.ok(prompt.systemPromptOptions.sections.pitools_activity.startsWith('[状态栏]'));
      assert.equal(prompt.systemPromptOptions.sections.other_plugin, 'preserved');
      await emit('agent_start'); assert.ok(scheduled.size > 0);
      assert.ok([...scheduled].some(t => t.delay <= 120));
      const activityMessage = { role: 'assistant', content: [{ type: 'thinking', thinking: '⏵ PRIVATE-REASONING' }, { type: 'text', text: '⏵ 验证左侧活动\n正常回复正文' }], usage: { output: 23 } };
      await emit('message_start', { message: activityMessage });
      await emit('message_update', { message: activityMessage, assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: '⏵ PRIVATE-REASONING' } });
      assert.ok(!strip(widget.render(160)[0]).includes('PRIVATE-REASONING'));
      await emit('message_update', { message: activityMessage, assistantMessageEvent: { type: 'text_delta', contentIndex: 1, delta: '⏵ 验证左侧活动' } });
      const header = strip(widget.render(160)[0]);
      assert.ok(/^● [🌑🌒🌓🌔🌕🌖🌗🌘]/u.test(header), 'status marker and activity must start at column zero');
      assert.ok(header.includes('⏵ 验证左侧活动'));
      assert.ok(header.indexOf('pitools · 第 ') > header.indexOf('⏵'), 'statistics follow activity, not the other way around');
      const assertHeaderColor = (component, markerColor = 'muted') => { const line = component.render(160)[0]; const plain = strip(line); assert.ok(plain.startsWith('● ')); assert.equal(line, theme.fg(markerColor, '●') + ' ' + theme.fg('accent', plain.slice(2)), 'only the dot changes color; all text stays accent'); };
      assertHeaderColor(widget);
      assert.ok(/^● [🌑🌒🌓🌔🌕🌖🌗🌘]/u.test(strip(widget.render(20)[0])), 'narrow screens prioritize marker and activity');
      widths(widget);
      const activityDetail = command(''); widths(inspector); assertHeaderColor(inspector);
      assert.ok(/^● [🌑🌒🌓🌔🌕🌖🌗🌘]/u.test(strip(inspector.render(160)[0])));
      inspector.handleInput('\x1b'); await activityDetail;
      const presets = JSON.parse(fs.readFileSync(path.join(path.dirname(entry), 'data/activity/frames.json'), 'utf8')).presets;
      for (const preset of Object.keys(presets)) { await command(`activity frames ${preset}`); widths(widget); }
      await command('activity frames moon8');
      const beforeStream = scheduled.size;
      for (let i = 0; i < 20; i++) await emit('message_update', { message: activityMessage, assistantMessageEvent: { type: 'text_delta', contentIndex: 1, delta: 'x' } });
      assert.ok(scheduled.size <= 2 && scheduled.size <= Math.max(2, beforeStream), 'at most one wake and one throttled paint, never a per-token queue');
      await emit('message_end', { message: activityMessage });
      await emit('tool_execution_start', { toolCallId: 'activity-failure', toolName: 'bash', args: { command: 'false' } });
      await emit('tool_execution_end', { toolCallId: 'activity-failure', toolName: 'bash', result: { content: [] }, isError: true });
      assertHeaderColor(widget, 'error'); // Only the dot is red after tool failure.
      await emit('agent_end', { messages: [activityMessage] });
      assert.equal(scheduled.size, 0, 'done must stop animation and throttled paint clocks');
      const summary = strip(widget.render(160)[0]); assert.ok(summary.includes('1 工具'));
      assert.ok(/^● [🌑🌒🌓🌔🌕🌖🌗🌘]/u.test(summary));
      assert.ok(summary.includes('⏵ 验证左侧活动'), 'completion preserves actual visible narration');
      assertHeaderColor(widget, 'error');
      assert.equal(strip(widget.render(160)[0]), summary);
      await emit('agent_start'); assertHeaderColor(widget, 'muted');
      const healthy = { role: 'assistant', content: [{ type: 'text', text: 'healthy completed activity' }] };
      await emit('message_start', { message: healthy }); await emit('message_end', { message: healthy });
      await emit('agent_end', { messages: [healthy] }); assertHeaderColor(widget, 'success');
      assert.equal(scheduled.size, 0);
      await command('activity off'); assert.ok(!strip(widget.render(160)[0]).startsWith('● '));
      await emit('before_agent_start', prompt); assert.equal(prompt.systemPromptOptions.sections.pitools_activity, undefined);
      assert.equal(prompt.systemPromptOptions.sections.other_plugin, 'preserved');
      await command('activity frames moon8'); await command('activity lang en'); await command('activity on');
      await emit('before_agent_start', prompt); assert.ok(prompt.systemPromptOptions.sections.pitools_activity.startsWith('[Status line]'));
      const preferences = persisted.filter(p => p.type === 'pitools-activity-config').map(p => ({ type: 'custom', customType: p.type, data: p.data }));
      ctx.sessionManager.getBranch = () => preferences; await emit('session_tree');
      await emit('before_agent_start', prompt); assert.ok(prompt.systemPromptOptions.sections.pitools_activity.startsWith('[Status line]'), 'saved language should restore from current branch');
      assert.equal(scheduled.size, 0);
      assert.ok(strip(widget.render(160)[0]).includes('⏵ Idle'), 'idle activity also respects restored language');
      // JSON/print modes have no terminal API. They must neither draw nor inject.
      const realUi = ctx.ui;
      for (const mode of ['json', 'print']) {
        ctx.mode = mode; ctx.ui = new Proxy({}, { get() { throw new Error('terminal UI touched in ' + mode); } });
        await emit('session_start'); await emit('before_agent_start', prompt);
        assert.equal(prompt.systemPromptOptions.sections.pitools_activity, undefined);
        await emit('agent_start'); await emit('message_start', { message: activityMessage });
        await emit('message_update', { message: activityMessage, assistantMessageEvent: { type: 'text_delta', contentIndex: 1, delta: 'x' } });
        await emit('message_end', { message: activityMessage }); await emit('agent_end', { messages: [activityMessage] });
        assert.equal(scheduled.size, 0); await emit('session_shutdown');
      }
      ctx.mode = 'tui'; ctx.ui = realUi;
    } finally { globalThis.setTimeout = originalSetTimeout; globalThis.clearTimeout = originalClearTimeout; }
    // Message-end-only blocks must also render, and malformed message data must
    // not throw while replaying session entries.
    ctx.sessionManager.getBranch = () => [null, { type: 'message', message: null },
      { type: 'message', message: { role: 'user', content: '恢复轨迹' } },
      { type: 'message', message: { role: 'assistant', content: [null, { type: 'thinking', thinking: '', thinkingSignature: 'opaque' }, { type: 'toolCall', id: 'restored', name: 'bash', arguments: { command: 'echo replay' } }] } },
      { type: 'message', message: { role: 'toolResult', toolCallId: 'restored', toolName: 'bash', content: [null, { type: 'text', text: 'replayed' }], isError: false } }];
    await emit('session_tree'); widths(widget);
    assert.ok(strip(widget.render(160)[0]).includes('2 个事件 · 已收起 1 个空思考'), 'replay should hide the empty thought without losing its tool');
    for (let i = 0; i < 2005; i++) await emit('message_start', { message: { role: 'user', content: `retained ${i}` } });
    await command('prev');
    const pinned = strip(widget.render(160)[4]).split(' · ').slice(1).join(' · ');
    for (let i = 0; i < 5; i++) await emit('message_start', { message: { role: 'user', content: `new ${i}` } });
    assert.equal(strip(widget.render(160)[4]).split(' · ').slice(1).join(' · '), pinned, 'retention must not move selection to a different event');
    await emit('session_tree');
    // Run the actual Pi TUI renderer/compositor against an in-memory terminal.
    // No real stdin, credentials, network, or model requests are involved.
    const writes = [];
    const terminal = { columns: 80, rows: 30, kittyProtocolActive: false,
      start() {}, stop() {}, async drainInput() {}, write(s) { writes.push(s); },
      moveBy() {}, hideCursor() {}, showCursor() {}, clearLine() {}, clearFromCursor() {}, clearScreen() {}, setTitle() {}, setProgress() {} };
    await emit('agent_start'); // Compose an active moon header in the actual TUI.
    for (const Tui of [TuiMainScreen, TuiAltScreen]) {
    await command('on');
    const realTui = new Tui(terminal);
    try {
      realTui.addChild(widget); realTui.start();
      for (const w of [8, 20, 80, 160]) { terminal.columns = w; realTui.renderNow(true); }
      const detailPending = command('');
      realTui.clear(); realTui.addChild(inspector); realTui.setFocus(inspector);
      for (const w of [8, 20, 80, 160]) { terminal.columns = w; realTui.renderNow(true); }
      inspector.handleInput('\x1bt'); await detailPending; assert.equal(widget, undefined);
      assert.ok(writes.length > 0);
    } finally { realTui.stop(); }
    }
    assert.deepEqual(notifications, [], 'healthy rendering must not silently fall back or report warnings');
    // Fault injection: a renderer failure must not escape into Pi's process.
    await command('on');
    const originalStyle = theme.style;
    theme.style = () => { throw new Error('injected theme failure'); };
    try {
      assert.doesNotThrow(() => widget.render(80));
      assert.doesNotThrow(() => widget.render(80));
      assert.equal(notifications.length, 1, 'a broken renderer should only notify once');
    } finally { theme.style = originalStyle; }
  } finally {
    inspector?.dispose(); await emit('session_shutdown'); await emit('session_shutdown');
    if (isolated) fs.rmSync(isolated, { recursive: true, force: true });
  }
  console.log(`PASS: ${bundle ? 'bundled' : 'modular'} ${themeName}/${mode}; real loader/Theme/TUI; left-first activity/uniform text/gray-green-red status dot/35 presets/contract/idle clocks/non-TUI; streaming blocks; input/tool/model timing; saved timing replay; abort fallback; exact message identity; empty/signed reasoning; replay; resizing; toggle; syntax/Markdown/raw; search; renderer fault isolation; repeated shutdown.`);
}
for (const themeName of ['dark', 'light']) for (const mode of ['truecolor', '256color']) await verify(themeName, mode);
await verify('system', 'terminal-default');
