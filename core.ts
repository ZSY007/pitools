// Pure state and display helpers. No filesystem, networking, or process access.
export const CORE_VERSION = '0.1.9';
export function safeText(value) {
  return String(value ?? '').replace(/\r\n?/g, '\n').replace(/\t/g, '    ')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069]/g, '');
}
export function json(value) {
  try { return safeText(JSON.stringify(value, null, 2) ?? '(无)'); }
  catch { return '(无法序列化)'; }
}
export function contentText(content) {
  if (typeof content === 'string') return safeText(content);
  if (!Array.isArray(content)) return content == null ? '' : json(content);
  return content.map(p => p?.type === 'text' ? safeText(p.text)
    : p?.type === 'thinking' ? safeText(p.thinking)
    : p?.type === 'image' ? `[图片 ${safeText(p.mimeType)}，不在终端展开]` : json(p)).join('\n');
}
export function emptyThinking(block) {
  return block?.type === 'thinking' && !safeText(block.thinking).trim();
}
export function missingThinkingCount(content) {
  return Array.isArray(content) ? content.filter(emptyThinking).length : 0;
}
export function summary(record) {
  if (record.kind === 'model' && record.name === '思考' && record.live && !safeText(record.text).trim()) return '思考中…';
  if (record.kind !== 'tool') return safeText(record.text).replace(/\n/g, ' ').slice(0, 512);
  const a = record.args ?? {};
  return safeText(a.command ?? a.path ?? a.file_path ?? a.filePath ?? json(a)).replace(/\n/g, ' ').slice(0, 512);
}
export function duration(record, now = Date.now()) {
  if (Number.isFinite(record.elapsed) && record.elapsed >= 0) return `${(record.elapsed / 1000).toFixed(2)}s`;
  if (record.live && Number.isFinite(record.start)) return `${(Math.max(0, now - record.start) / 1000).toFixed(2)}s…`;
  return '历史耗时未知';
}
export function validTimestamp(value) {
  const number = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) ? Date.parse(value) : value;
  return typeof number === 'number' && Number.isFinite(number) && number > 0 && number < 8640000000000000 ? number : undefined;
}
export function validModelTiming(data) {
  if (!data || typeof data.start !== 'number' || typeof data.end !== 'number' || validTimestamp(data.start) === undefined || validTimestamp(data.end) === undefined || data.end < data.start || !Number.isFinite(data.elapsed) || data.elapsed < 0 || data.elapsed > 8640000000000000) return undefined;
  const timing = { start: data.start, end: data.end, elapsed: data.elapsed, timingSource: 'saved-local-observation' };
  if (Number.isFinite(data.firstTokenMs) && data.firstTokenMs >= 0 && data.firstTokenMs <= data.elapsed) timing.firstTokenMs = data.firstTokenMs;
  return timing;
}
function displayTime(value, missing) {
  const timestamp = validTimestamp(value);
  if (timestamp === undefined) return missing;
  const date = new Date(timestamp);
  const offset = -date.getTimezoneOffset();
  const zone = `UTC${offset >= 0 ? '+' : '-'}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0')}:${String(Math.abs(offset) % 60).padStart(2, '0')}`;
  return `${date.toLocaleString('zh-CN', { hourCycle: 'h23' })}.${String(date.getMilliseconds()).padStart(3, '0')} ${zone}`;
}
export function timingInfo(record, now = Date.now()) {
  if (record.kind === 'input') return {
    提交时间: displayTime(record.recordedAt, '历史未记录提交时间'),
    时间来源: record.recordedAtSource === 'message' ? '会话消息时间戳' : record.recordedAtSource === 'entry' ? '会话条目时间戳' : record.recordedAtSource === 'observed' ? '本地收到输入的时刻' : '不可用',
  };
  const missing = record.replay ? '历史未记录' : '未记录';
  const elapsed = Number.isFinite(record.elapsed) && record.elapsed >= 0 ? record.elapsed : record.live && validTimestamp(record.start) !== undefined ? Math.max(0, now - record.start) : undefined;
  const result = {
    开始时间: displayTime(record.start, missing),
    结束时间: record.live ? '进行中' : record.incomplete ? '未收到完整消息结束事件' : displayTime(record.end, missing),
    [record.kind === 'tool' ? '执行耗时' : '总时长_助手消息整体']: elapsed === undefined ? missing : `${(elapsed / 1000).toFixed(2)}s${record.live ? '（进行中）' : ''}`,
    计时来源: elapsed === undefined ? '不可用；不以相邻消息时间差估算' : record.kind === 'tool' ? record.replay ? 'pitools 保存的工具执行计时' : '本地工具生命周期观测' : record.timingSource === 'saved-local-observation' ? 'pitools 保存的本地消息观测' : '本地 message_start/end 观测（不是供应商原始请求计时）',
  };
  if (record.kind === 'model') {
    const first = Number.isFinite(record.firstTokenMs) && record.firstTokenMs >= 0 && (elapsed === undefined || record.firstTokenMs <= elapsed) ? record.firstTokenMs : undefined;
    result.首可见内容事件延迟_本地观测 = first === undefined ? record.live ? '尚未收到可见思考/文本' : record.replay && record.timingSource !== 'saved-local-observation' ? '历史未记录；无法恢复原始 TTFT' : '未记录有效的首可见思考/文本 delta 计时' : `${(first / 1000).toFixed(2)}s`;
    if (first !== undefined && elapsed !== undefined) result.首内容之后耗时_本地观测 = `${(Math.max(0, elapsed - first) / 1000).toFixed(2)}s`;
    if (validTimestamp(record.messageAt) !== undefined) result.会话消息时间戳_不冒充开始时间 = displayTime(record.messageAt, missing);
  }
  return result;
}
export class TraceStore {
  constructor(limit = 2000) { this.limit = limit; this.reset(); }
  reset() { this.records = []; this.calls = new Map(); this.turn = 0; this.dropped = 0; this.hiddenThinking = 0; }
  remove(record) {
    const index = this.records.indexOf(record);
    if (index < 0) return;
    this.records.splice(index, 1);
    if (record.kind === 'tool' && this.calls.get(record.id) === record) this.calls.delete(record.id);
  }
  add(record) {
    this.records.push(record);
    // Never evict running operations, even with a very large parallel batch.
    while (this.records.length > this.limit) {
      const index = this.records.findIndex(r => !r.live);
      if (index < 0) break;
      const [old] = this.records.splice(index, 1);
      if (old.kind === 'tool') this.calls.delete(old.id);
      this.dropped++;
    }
    return record;
  }
  start(id, name, args, now = Date.now(), parent) {
    let r = this.calls.get(id);
    if (!r) { r = this.add({ kind: 'tool', id, name, args, turn: this.turn, start: now, live: true, parent }); this.calls.set(id, r); }
    else Object.assign(r, { name, args, start: now, live: true, parent });
    return r;
  }
  end(id, name, result, error, now = Date.now()) {
    let r = this.calls.get(id);
    if (!r) {
      // Add as live so a full batch of running calls cannot evict this record
      // before the call-map entry is created.
      r = this.add({ kind: 'tool', id, name, turn: this.turn, live: true }); this.calls.set(id, r);
    }
    Object.assign(r, { result, error, live: false, end: now });
    if (r.start !== undefined) r.elapsed = Math.max(0, now - r.start);
    return r;
  }
  restore(entries) {
    this.reset();
    const timings = new Map();
    const modelTimings = new Map();
    entries = Array.isArray(entries) ? entries : [];
    for (const e of entries) if (e?.type === 'custom') {
      const d = e.data;
      if (e.customType === 'pitools-timing' && d && typeof d.id === 'string' && Number.isFinite(d.elapsed) && d.elapsed >= 0) timings.set(d.id, d);
      if (e.customType === 'pitools-model-timing' && typeof d?.messageEntryId === 'string') {
        const timing = validModelTiming(d);
        if (timing) modelTimings.set(d.messageEntryId, timing);
      }
    }
    for (const e of entries) {
      if (e?.type !== 'message' || !e.message || typeof e.message !== 'object') continue;
      const m = e.message;
      if (m.role === 'user') {
        this.turn++;
        const messageAt = validTimestamp(m.timestamp), entryAt = validTimestamp(e.timestamp);
        this.add({ kind: 'input', name: '输入', text: contentText(m.content), turn: this.turn, recordedAt: messageAt ?? entryAt, recordedAtSource: messageAt !== undefined ? 'message' : entryAt !== undefined ? 'entry' : undefined, replay: true });
      }
      if (m.role === 'assistant') {
        const hidden = missingThinkingCount(m.content);
        this.hiddenThinking += hidden;
        for (const p of Array.isArray(m.content) ? m.content : []) {
          if (!p || typeof p !== 'object' || emptyThinking(p)) continue;
          if (p.type === 'toolCall' && typeof p.id === 'string') {
            const r = this.start(p.id, p.name, p.arguments); r.live = false; r.start = undefined; r.replay = true; r.hiddenThinkingBlocks = hidden;
          } else if (p.type === 'thinking' || p.type === 'text') {
            this.add({ kind: 'model', name: p.type === 'thinking' ? '思考' : '回复', text: contentText([p]), raw: p, usage: m.usage, turn: this.turn, hiddenThinkingBlocks: hidden, replay: true, error: m.stopReason === 'error', aborted: m.stopReason === 'aborted', messageEntryId: e.id, messageAt: validTimestamp(m.timestamp) ?? validTimestamp(e.timestamp), ...(modelTimings.get(e.id) ?? {}) });
          }
        }
      }
      if (m.role === 'toolResult') {
        const r = this.end(m.toolCallId, m.toolName, m, m.isError); r.replay = true; r.end = undefined;
      }
    }
    for (const r of this.records) if (timings.has(r.id)) {
      const t = timings.get(r.id); r.elapsed = t.elapsed;
      if (Number.isFinite(t.start) && t.start > 0 && t.start < 8640000000000000) r.start = t.start;
      if (Number.isFinite(t.end) && t.end >= (r.start ?? 0) && t.end < 8640000000000000) r.end = t.end;
    }
  }
}
