// Regression for updating transitive helpers within the same Node process.
// All writes are to an isolated temporary directory, never the deployed plugin.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const host = process.env.PI_HOST_ROOT;
if (!host) throw new Error('Set PI_HOST_ROOT to the installed Pi package directory.');
const modular = await import(pathToFileURL(path.join(host, 'dist/core/extensions/loader.js')));
const bundled = await import(pathToFileURL(path.join(host, 'dist/bundle/index.js')));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pitools-reload-'));
const entrySource = (helper, expectFunctions = false) => `
import * as core from './${helper}';
export default function(pi) {
  ${expectFunctions ? "if (typeof core.emptyThinking !== 'function' || typeof core.missingThinkingCount !== 'function') throw new Error('stale helper exports');" : ''}
  pi.registerCommand('reload-probe', { description: core.revision, handler: async () => {} });
}`;
const v1 = "export const revision = 'v1';\n";
const v2 = "export const revision = 'v2';\nexport function emptyThinking() { return true; }\nexport function missingThinkingCount() { return 1; }\n";
try {
  for (const name of ['modular', 'bundled']) {
    const load = async (entry, cwd) => name === 'modular'
      ? modular.loadExtensions([entry], cwd)
      : bundled.discoverAndLoadExtensions([entry], cwd, path.join(cwd, 'isolated-agent'));
    for (const ext of ['mjs', 'ts']) {
      const cwd = path.join(root, `${name}-${ext}`); fs.mkdirSync(cwd, { recursive: true });
      const entry = path.join(cwd, 'index.ts'), helper = path.join(cwd, `core.${ext}`);
      fs.writeFileSync(helper, v1); fs.writeFileSync(entry, entrySource(`core.${ext}`));
      const first = await load(entry, cwd);
      assert.deepEqual(first.errors, []);
      assert.equal(first.extensions[0].commands.get('reload-probe').description, 'v1');
      first.runtime.invalidate?.('test reload');
      fs.writeFileSync(helper, v2); fs.writeFileSync(entry, entrySource(`core.${ext}`, true));
      modular.clearExtensionCache();
      const second = await load(entry, cwd);
      if (ext === 'ts') {
        assert.deepEqual(second.errors, [], `${name}: TypeScript helper must reload new exports`);
        assert.equal(second.extensions[0].commands.get('reload-probe').description, 'v2');
        second.runtime.invalidate?.('test complete');
        console.log(`PASS: ${name}; .ts helper upgraded v1 → v2 in the same process.`);
      } else {
        const stale = second.errors.length > 0 || second.extensions[0].commands.get('reload-probe').description !== 'v2';
        console.log(`DIAGNOSTIC: ${name}; legacy .mjs same-process update: ${stale ? 'STALE EXPORTS REPRODUCED' : 'fresh in this loader'}.`);
        second.runtime.invalidate?.('test complete');
      }
    }
    // Warm an old native helper, then install the COMPLETE real plugin in the
    // same process and fire its actual handlers (not only a probe factory).
    const cwd = path.join(root, `${name}-production`); fs.mkdirSync(cwd);
    const entry = path.join(cwd, 'index.ts');
    fs.writeFileSync(path.join(cwd, 'core.mjs'), v1);
    fs.writeFileSync(entry, entrySource('core.mjs'));
    const old = await load(entry, cwd);
    assert.deepEqual(old.errors, []); old.runtime.invalidate?.('upgrade');
    const source = fileURLToPath(new URL('..', import.meta.url));
    for (const file of ['index.ts', 'core.ts', 'rendering.ts', 'activity.ts', 'package.json']) fs.copyFileSync(path.join(source, file), path.join(cwd, file));
    fs.cpSync(path.join(source, 'data'), path.join(cwd, 'data'), { recursive: true });
    const themeApi = await import(pathToFileURL(path.join(host, 'dist/modes/interactive/theme/theme.js')));
    const theme = themeApi.getThemeByName('dark'); themeApi.setThemeInstance(theme);
    async function exercise(expectedPlaceholder = '思考中…', rounds = 5, expectedFrame) {
      modular.clearExtensionCache();
      const current = await load(entry, cwd); assert.deepEqual(current.errors, []);
      const extension = current.extensions[0], notifications = [];
      current.runtime.appendEntry = () => {};
      current.runtime.getAllTools = () => [];
      let widget;
      const ctx = { mode: 'tui', hasUI: true, sessionManager: { getBranch: () => [] }, ui: {
        notify(text, level) { notifications.push({ text, level }); },
        setWidget(_key, factory) { widget = factory?.({ requestRender() {} }, theme); },
      } };
      const emit = async (event, data = {}) => { for (const handler of extension.handlers.get(event) ?? []) await handler(data, ctx); };
      try {
        await emit('session_start');
        for (let i = 0; i < rounds; i++) {
          const message = { role: 'assistant', content: [{ type: 'thinking', thinking: '', thinkingSignature: 'opaque' }] };
          await emit('message_start', { message });
          await emit('message_update', { message, assistantMessageEvent: { type: 'thinking_start', contentIndex: 0 } });
          assert.ok(widget.render(160).join('\n').includes(expectedPlaceholder));
          if (expectedFrame) assert.ok(widget.render(160)[0].includes(expectedFrame), 'TS data helper must hot-reload along with activity state');
          await emit('message_end', { message });
          await emit('tool_execution_start', { toolCallId: `call-${i}`, toolName: 'read', args: { path: 'example.txt' } });
          await emit('tool_execution_end', { toolCallId: `call-${i}`, toolName: 'read', result: { content: [{ type: 'text', text: 'test' }] }, isError: false });
          await emit('agent_end');
        }
        assert.ok(widget.render(160)[0].includes(`已收起 ${rounds} 个空思考`));
        assert.deepEqual(notifications, []);
        await extension.commands.get('pitools').handler('version', ctx);
        const version = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8')).version;
        assert.ok(notifications[0].text.includes(`pitools ${version}`));
      } finally { await emit('session_shutdown'); current.runtime.invalidate?.('reload'); }
    }
    await exercise();
    const helperPath = path.join(cwd, 'core.ts');
    const original = fs.readFileSync(helperPath, 'utf8');
    fs.writeFileSync(helperPath, original.replace("return '思考中…'", "return '热升级验证已更新…'"));
    await exercise('热升级验证已更新…', 3);
    const dataPath = path.join(cwd, 'data/activity/data.ts');
    const dataSource = fs.readFileSync(dataPath, 'utf8');
    fs.writeFileSync(dataPath, dataSource.replace(/"frames": \[\s*"🌑",[\s\S]*?\]/, '"frames": ["RELOAD-FRAME"]'));
    await exercise('热升级验证已更新…', 2, 'RELOAD-FRAME');
    fs.writeFileSync(dataPath, dataSource);
    // Mixed file versions must fail at factory time, never leave stream handlers
    // registered that repeatedly throw during every message.
    fs.writeFileSync(helperPath, original.replace(/export const CORE_VERSION = '[^']+';/, "export const CORE_VERSION = 'mismatch';"));
    const mixed = await load(entry, cwd);
    assert.equal(mixed.extensions.length, 0); assert.equal(mixed.errors.length, 1);
    assert.ok(mixed.errors[0].error.includes('模块版本不一致'));
    mixed.runtime.invalidate?.('complete');
    console.log(`PASS: ${name}; complete plugin upgrades after warmed .mjs; actual stream/message/tool handlers; second TS hot update; mixed-version fail-fast.`);
  }
} finally { fs.rmSync(root, { recursive: true, force: true }); }
