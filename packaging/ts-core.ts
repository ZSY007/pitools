// Pure TS edition adapter. No child_process, executable resolution or worker transport.
import { ActivityState } from './activity.ts';
import { visibleTextTail } from './core.ts';
export const PYTHON_CORE_VERSION = '0.1.13';
export const RUST_CORE_VERSION = PYTHON_CORE_VERSION;
export class ActivityCore {
  ts = new ActivityState();
  requested = 'ts' as const;
  worker = undefined;
  starting = undefined;
  failure: string | undefined;
  verify = false;
  matches = 0;
  mismatches = 0;
  private options: { onChange: (mode: 'now' | 'soon' | 'none') => void };
  constructor(options: { onChange: (mode: 'now' | 'soon' | 'none') => void }) { this.options = options; }
  get worker_active() { return false; }
  get python_active() { return false; }
  get rust_active() { return false; }
  get effective() { return 'ts' as const; }
  get config() { return this.ts.config; }
  get lang() { return this.ts.lang; }
  get live() { return this.ts.live; }
  get phase() { return this.ts.phase; }
  get failed() { return this.ts.failure; }
  get readyForPaint() { return true; }
  configure(config: any) { this.ts.configure(config); }
  reset(config?: any) { this.ts.reset(config); }
  begin(now: number) { this.ts.begin(now); }
  turnStart(now: number) { this.ts.turnStart(now); }
  streamStart(now: number) { this.ts.streamStart(now); }
  delta(type: string, text: string, now: number) { this.ts.delta(type, text, now); }
  messageEnd(message: any, now: number) { this.ts.messageEnd(message, now, visibleTextTail(message?.content)); }
  toolStart(id: string, name: any, args: any, now: number) { this.ts.toolStart(id, name, args, now); }
  toolEnd(id: string, error: any, now: number) { this.ts.toolEnd(id, error, now); }
  finish(now: number, reason = '') { this.ts.finish(now, reason); }
  line(now: number) { return this.ts.line(now); }
  nextWakeAt(now: number) { return this.ts.nextWakeAt(now); }
  tick() { this.options.onChange('now'); }
  requestPaintView() {}
  completePaint() {}
  useTs() {}
  dispose() {}
  async usePython() { return 'edition_unavailable'; }
  async useRust() { return 'edition_unavailable'; }
  status() { return '请求 TS · 实际 TS · 独立 TS 包（无 worker）'; }
}
