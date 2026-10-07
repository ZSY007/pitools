# Python core parity tests. Standard library only:
#   python -m unittest discover -s python/tests
import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'python'))
from pitools_core import CORE_VERSION  # noqa: E402
from pitools_core.activity import (FRAME_NAMES, ActivityState, cut_columns, extract_narration, mix_slot,  # noqa: E402
  normalize_activity, tool_action, PHRASES, _fixed1)
import pitools_worker  # noqa: E402

GOLDEN = json.loads((ROOT / 'tests' / 'fixtures' / 'activity-golden.json').read_text(encoding='utf-8'))


def replay(scenario):
  out = []
  worker = pitools_worker.Worker(out.append)
  assert worker.handle(json.dumps({'protocol': 1, 'type': 'hello', 'version': CORE_VERSION, 'locale': scenario['locale']}).encode())
  views = {}
  for frame in scenario['frames']:
    out.clear()
    worker.handle(json.dumps(frame).encode())
    for raw in out:
      reply = json.loads(raw)
      if reply['type'] != 'view':
        raise AssertionError(f'unexpected reply {reply}')
      views[str(reply['id'])] = [reply['line'], reply['phase'], reply['failure'], reply['live'], reply['nextWakeAt']]
  return views


class GoldenParity(unittest.TestCase):
  def test_every_golden_view_matches_the_ts_core(self):
    total = 0
    for scenario in GOLDEN['scenarios']:
      views = replay(scenario)
      for view_id, expected in scenario['expect'].items():
        with self.subTest(seed=scenario['seed'], view=view_id):
          self.assertEqual(views.get(view_id), expected)
        total += 1
    self.assertGreater(total, 1000)


  def test_golden_delta_batches_keep_every_intermediate_view(self):
    for scenario in GOLDEN['scenarios']:
      out = []
      worker = pitools_worker.Worker(out.append)
      worker.handle(json.dumps({'protocol': 1, 'type': 'hello', 'version': CORE_VERSION, 'locale': scenario['locale']}).encode())
      pending, views = [], {}
      def flush():
        if pending:
          worker.handle(json.dumps({'protocol': 1, 'type': 'event_batch', 'events': pending}).encode())
          pending.clear()
      for frame in scenario['frames']:
        if frame.get('type') == 'event' and frame.get('op') == 'delta':
          pending.append(frame)
          if len(pending) == 16:
            flush()
        else:
          flush()
          out.clear()
          worker.handle(json.dumps(frame).encode())
          for raw in out:
            reply = json.loads(raw)
            if reply['type'] == 'view':
              views[str(reply['id'])] = [reply['line'], reply['phase'], reply['failure'], reply['live'], reply['nextWakeAt']]
      flush()
      for view_id, expected in scenario['expect'].items():
        self.assertEqual(views.get(view_id), expected)


class Semantics(unittest.TestCase):
  def test_mix_slot_is_js_32bit_exact(self):
    # Values computed with activity.ts mixSlot (Math.imul / >>>).
    self.assertEqual([mix_slot(1776427200000, 0), mix_slot(1776427200000, 0x5EED), mix_slot(-5, 123), mix_slot(2**40 + 7, 9)],
      [3216925767, 2884614188, 2601976859, 3707979298])
    self.assertEqual(mix_slot(0, 0), 0)
    self.assertEqual(mix_slot(-1, 7), mix_slot(0xFFFFFFFF, 7))
    self.assertEqual(mix_slot(2**32 + 5, 3), mix_slot(5, 3))
    self.assertEqual(mix_slot(float('nan'), 1), mix_slot(0, 1))
    self.assertEqual(mix_slot(-1.9, 1), mix_slot(-1, 1))

  def test_narration_tail_counts_utf16_units(self):
    # 150 astral emoji = 300 UTF-16 units; the marker before them is outside the tail.
    self.assertIsNone(extract_narration('⏵ x' + '\U0001F600' * 150))
    self.assertEqual(extract_narration('\n⏵ ok\n' + 'a' * 294), 'ok')
    self.assertIsNone(extract_narration('text⏵ ' + 'a' * 298))

  def test_js_dollar_and_whitespace(self):
    self.assertEqual(extract_narration('⏵ a.\n'), 'a')
    self.assertEqual(extract_narration('⏵ ﻿ x ﻿'), 'x')
    self.assertEqual(cut_columns('中文ab', 5), '中文a')

  def test_ascii_only_case_folding_like_js_non_unicode_regex(self):
    self.assertIn(tool_action('READ', 'zh', 1, 0), PHRASES['toolAction']['zh'][0]['actions'])
    self.assertIn(tool_action('ſearch', 'zh', 1, 0), PHRASES['toolFallback']['zh'])
    self.assertIn(tool_action('read\n', 'zh', 1, 0), PHRASES['toolAction']['zh'][0]['actions'])  # fragment trims

  def test_to_fixed_rounds_ties_up_like_js(self):
    self.assertEqual(_fixed1(1.25), '1.3')
    self.assertEqual(_fixed1(1.35), '1.4')  # Exact binary value is just above the tie, as in JS.
    self.assertEqual(_fixed1(2.45), '2.5')
    self.assertEqual(_fixed1(0.05), '0.1')

  def test_config_and_presets(self):
    self.assertEqual(len(FRAME_NAMES), 35)
    self.assertEqual(normalize_activity({'frames': '__proto__', 'enabled': 'false', 'lang': 'xx'})['frames'], 'moon8')
    state = ActivityState(locale='en-US')
    state.configure({'lang': 'auto'})
    self.assertEqual(state.line(0), '🌑 ⏵ Idle · ready for a task')
    self.assertIsNone(state.next_wake_at(0))


class WorkerProtocol(unittest.TestCase):
  def setUp(self):
    self.out = []
    self.worker = pitools_worker.Worker(self.out.append)

  def send(self, payload):
    self.out.clear()
    return self.worker.handle(json.dumps({'protocol': 1, **payload}).encode())

  def replies(self):
    return [json.loads(raw) for raw in self.out]

  def test_version_mismatch_is_fatal(self):
    self.assertFalse(self.send({'type': 'hello', 'version': '0.0.0'}))
    self.assertEqual(self.replies()[0]['category'], 'version_mismatch')

  def test_old_epoch_and_replayed_seq_are_ignored(self):
    self.send({'type': 'hello', 'version': CORE_VERSION, 'locale': 'zh-CN'})
    self.send({'type': 'event', 'epoch': 2, 'seq': 1, 'op': 'reset', 'config': {}})
    self.send({'type': 'event', 'epoch': 2, 'seq': 2, 'op': 'begin', 'now': 1000, 'local': [2026, 4, 17, 5, 12]})
    self.send({'type': 'event', 'epoch': 1, 'seq': 3, 'op': 'finish', 'now': 2000, 'local': [2026, 4, 17, 5, 12]})
    self.send({'type': 'event', 'epoch': 2, 'seq': 2, 'op': 'finish', 'now': 2000, 'local': [2026, 4, 17, 5, 12]})
    self.send({'type': 'event', 'epoch': 1, 'seq': 1, 'op': 'reset', 'config': {}})
    self.send({'type': 'view', 'epoch': 2, 'id': 1, 'now': 1500})
    self.assertEqual(self.replies()[0]['phase'], 'waiting')
    self.assertEqual(self.worker.ignored, 3)

  def test_batches_are_ordered_and_old_epoch_events_remain_ignored(self):
    self.send({'type': 'hello', 'version': CORE_VERSION})
    self.assertIn('event_batch', self.replies()[0]['features'])
    self.send({'type': 'event', 'epoch': 1, 'seq': 1, 'op': 'reset'})
    def delta(seq, text, epoch=1):
      return {'type': 'event', 'epoch': epoch, 'seq': seq, 'op': 'delta', 'now': 1000 + seq,
        'local': [2026, 4, 17, 5, 12], 'kind': 'text_delta', 'text': text}
    self.send({'type': 'event_batch', 'events': [delta(2, '\n⏵ first'), delta(3, '\n⏵ final'), delta(4, '\n⏵ OLD', 0)]})
    self.send({'type': 'view', 'epoch': 1, 'id': 1, 'now': 1100})
    self.assertIn('final', self.replies()[0]['line'])
    self.assertNotIn('OLD', self.replies()[0]['line'])
    self.assertEqual(self.worker.seq, 3)

  def test_invalid_batches_apply_nothing(self):
    self.send({'type': 'hello', 'version': CORE_VERSION})
    self.send({'type': 'event', 'epoch': 1, 'seq': 1, 'op': 'reset'})
    valid = {'type': 'event', 'epoch': 1, 'seq': 2, 'op': 'delta', 'now': 1000,
      'local': [2026, 4, 17, 5, 12], 'kind': 'text_delta', 'text': '\n⏵ SECRET'}
    for events in [[], [valid] * 65, [valid, {'type': 'event', 'op': 'finish'}]]:
      with self.assertRaises(pitools_worker.ProtocolError):
        self.send({'type': 'event_batch', 'events': events})
      self.assertEqual(self.worker.seq, 1)
      self.assertEqual(self.worker.state.phase, 'idle')
    with self.assertRaises(pitools_worker.ProtocolError):
      self.send({'type': 'event_batch', 'events': [{**valid, 'text': 'x' * 65536}]})
    self.assertEqual(self.worker.seq, 1)

  def test_rejects_nan_and_bad_fields_without_echoing_content(self):
    self.send({'type': 'hello', 'version': CORE_VERSION})
    self.assertRaises(pitools_worker.ProtocolError, self.worker.handle, b'{"protocol":1,"type":"view","epoch":NaN,"id":1,"now":1}')
    self.send({'type': 'event', 'epoch': 0, 'seq': 1, 'op': 'reset'})
    with self.assertRaises(pitools_worker.ProtocolError):
      self.send({'type': 'event', 'epoch': 0, 'seq': 2, 'op': 'delta', 'kind': 'text_delta', 'text': 'SECRET', 'now': 1, 'local': [1, 2]})


if __name__ == '__main__':
  unittest.main()
