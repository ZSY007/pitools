// Typed JSONL frames. Free-text values NEVER pass through serde_json::Value.
use crate::activity::{Config, Data, Snapshot, State};
use crate::js_string::JsString;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
pub const MAX_FRAME: usize = 1024 * 1024;
const MAX_SAFE: i64 = 9_007_199_254_740_991;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    #[serde(rename = "type", default)]
    pub(crate) kind_frame: String,
    pub epoch: i64,
    pub seq: i64,
    pub op: String,
    pub now: Option<i64>,
    pub local: Option<[i64; 5]>,
    pub config: Option<Config>,
    pub state: Option<Snapshot>,
    pub kind: Option<String>,
    pub text: Option<JsString>,
    pub message_key: Option<JsString>,
    pub output_tokens: Option<f64>,
    pub id: Option<JsString>,
    pub name: Option<JsString>,
    pub detail: Option<JsString>,
    pub error: Option<bool>,
    pub reason: Option<String>,
}
#[derive(Deserialize)]
struct Query {
    epoch: i64,
    id: i64,
    now: i64,
}
#[derive(Serialize, Debug)]
#[serde(tag = "type")]
pub enum Reply {
    #[serde(rename = "ready")]
    Ready {
        protocol: u8,
        version: &'static str,
        core: &'static str,
        rust: &'static str,
        unicode: &'static str,
        features: Vec<&'static str>,
        assets: [&'static str; 2],
    },
    #[serde(rename = "view", rename_all = "camelCase")]
    View {
        protocol: u8,
        epoch: i64,
        id: i64,
        line: JsString,
        phase: String,
        failure: bool,
        live: bool,
        next_wake_at: Option<f64>,
    },
    #[serde(rename = "error")]
    Error {
        protocol: u8,
        category: &'static str,
        epoch: i64,
    },
    #[serde(rename = "fatal")]
    Fatal {
        protocol: u8,
        category: &'static str,
    },
}
fn safe(n: i64) -> bool {
    (-MAX_SAFE..=MAX_SAFE).contains(&n)
}
fn phase(s: &str) -> bool {
    matches!(s, "idle" | "waiting" | "thinking" | "tool" | "done")
}
fn validate_snapshot(s: &Snapshot) -> Result<(), &'static str> {
    if !phase(&s.phase)
        || s.active.len() > 4096
        || s.seen_message_keys.len() > 65536
        || s.output_tokens < 0.0
        || !s.output_tokens.is_finite()
    {
        return Err("bad_state");
    }
    if s.last_tool.as_ref().is_some_and(|t| t.ended_at.is_none()) {
        return Err("bad_state");
    }
    if s.active.iter().any(|t| !t.started_at.is_finite()) {
        return Err("bad_state");
    }
    Ok(())
}
impl Event {
    fn validate(&self) -> Result<(), &'static str> {
        if !safe(self.epoch) || !safe(self.seq) {
            return Err("bad_sequence");
        }
        match self.op.as_str() {
            "snapshot" => return validate_snapshot(self.state.as_ref().ok_or("bad_state")?),
            "reset" | "configure" => return Ok(()),
            "begin" | "turnStart" | "streamStart" | "delta" | "messageEnd" | "toolStart"
            | "toolEnd" | "finish" => {}
            _ => return Err("unknown_op"),
        }
        if !self.now.is_some_and(safe) || !self.local.is_some_and(|a| a.iter().copied().all(safe)) {
            return Err("bad_time");
        }
        match self.op.as_str() {
            "delta" => {
                if !self.kind.as_ref().is_some_and(|s| s.len() <= 64) || self.text.is_none() {
                    return Err("bad_delta");
                }
            }
            "messageEnd" => {
                if self.text.is_none()
                    || self.message_key.is_none()
                    || self.output_tokens.is_some_and(|t| !t.is_finite())
                {
                    return Err("bad_message");
                }
            }
            "toolStart" => {
                if self.id.is_none() || self.name.is_none() {
                    return Err("bad_tool");
                }
            }
            "toolEnd" => {
                if self.id.is_none() {
                    return Err("bad_tool");
                }
            }
            _ => {}
        }
        Ok(())
    }
}
pub struct Worker {
    pub state: State,
    pub epoch: i64,
    pub seq: i64,
    ready: bool,
}
impl Worker {
    pub fn new(data: Arc<Data>) -> Self {
        Self {
            state: State::new(data, String::new()),
            epoch: -1,
            seq: -1,
            ready: false,
        }
    }
    pub fn error(&self, category: &'static str) -> Reply {
        Reply::Error {
            protocol: 1,
            category,
            epoch: self.epoch,
        }
    }
    fn event(&mut self, e: Event) {
        if matches!(e.op.as_str(), "reset" | "snapshot") {
            if e.epoch <= self.epoch {
                return;
            }
            self.epoch = e.epoch;
            self.seq = -1;
        } else if e.epoch != self.epoch || e.seq <= self.seq {
            return;
        }
        self.seq = e.seq;
        match e.op.as_str() {
            "reset" => {
                self.state.reset(e.config);
                return;
            }
            "snapshot" => {
                self.state.restore(e.state.unwrap());
                return;
            }
            "configure" => {
                self.state.configure(e.config.unwrap_or_default());
                return;
            }
            _ => {}
        }
        let now = e.now.unwrap() as f64;
        let local = e.local.unwrap();
        match e.op.as_str() {
            "begin" => self.state.begin(now, local),
            "turnStart" => self.state.turn_start(now, local),
            "streamStart" => self.state.stream_start(now, local),
            "delta" => self.state.delta(
                e.kind.as_deref().unwrap(),
                e.text.as_ref().unwrap(),
                now,
                local,
            ),
            "messageEnd" => self.state.message_end(
                e.text.as_ref().unwrap(),
                e.message_key.unwrap(),
                e.output_tokens,
                now,
                local,
            ),
            "toolStart" => self.state.tool_start(
                e.id.unwrap(),
                e.name.as_ref().unwrap(),
                e.detail.as_ref(),
                now,
                local,
            ),
            "toolEnd" => self
                .state
                .tool_end(e.id.as_ref().unwrap(), e.error.unwrap_or(false), now),
            "finish" => self.state.finish(now, e.reason.as_deref().unwrap_or("")),
            _ => unreachable!(),
        }
    }
    pub fn handle(&mut self, raw: &[u8]) -> Result<Option<Reply>, &'static str> {
        if raw.len() > MAX_FRAME {
            return Err("frame_too_large");
        }
        // Even ignored fields must not turn invalid byte streams into accepted JSON.
        std::str::from_utf8(raw).map_err(|_| "bad_utf8")?;
        let frame: crate::wire::Frame = serde_json::from_slice(raw).map_err(|_| "bad_json")?;
        if frame.protocol != 1 {
            return Err("protocol_mismatch");
        }
        if frame.frame_type == "hello" {
            if self.ready {
                return Err("already_ready");
            }
            if frame.version.as_deref() != Some(VERSION) {
                return Ok(Some(Reply::Fatal {
                    protocol: 1,
                    category: "version_mismatch",
                }));
            }
            self.state.locale = frame.locale.unwrap_or_default();
            self.ready = true;
            return Ok(Some(Reply::Ready {
                protocol: 1,
                version: VERSION,
                core: "rust",
                rust: "native",
                unicode: crate::marks::UNICODE_VERSION,
                features: vec!["event_batch", "delta_pack_v1"],
                assets: Data::source_hashes(),
            }));
        }
        if !self.ready {
            return Err("not_ready");
        }
        match frame.frame_type.as_str() {
            "event" => {
                let e = frame.event()?;
                e.validate()?;
                self.event(e);
                Ok(None)
            }
            "event_batch" => {
                if raw.len() > 65536 {
                    return Err("batch_too_large");
                }
                let events = frame.events.ok_or("bad_batch")?;
                if events.is_empty() || events.len() > 64 {
                    return Err("bad_batch");
                }
                for e in &events {
                    if e.kind_frame != "event" || e.op != "delta" {
                        return Err("bad_batch_event");
                    }
                    e.validate()?;
                }
                for e in events {
                    self.event(e);
                }
                Ok(None)
            }
            "delta_pack" => {
                if raw.len() > 65536 {
                    return Err("batch_too_large");
                }
                let groups = frame.groups.ok_or("bad_pack")?;
                let mut count = 0;
                if groups.is_empty() || groups.len() > 64 {
                    return Err("bad_pack");
                }
                // Validate every group, reference and clock before touching state or seq.
                for g in &groups {
                    count += g.rows.len();
                    if !safe(g.epoch)
                        || g.kind.len() > 64
                        || !g.local.iter().copied().all(safe)
                        || g.rows.is_empty()
                        || g.texts.is_empty()
                        || g.texts.len() > 64
                        || g.texts.iter().any(|s| s.0.len() > 301)
                        || g.rows.iter().any(|(seq, now, index)| {
                            !safe(*seq) || !safe(*now) || *index >= g.texts.len()
                        })
                    {
                        return Err("bad_pack");
                    }
                }
                if count > 64 {
                    return Err("bad_pack");
                }
                for g in groups {
                    for (seq, now, index) in g.rows {
                        if g.epoch != self.epoch || seq <= self.seq {
                            continue;
                        }
                        self.seq = seq;
                        self.state
                            .delta(&g.kind, &g.texts[index], now as f64, g.local);
                    }
                }
                Ok(None)
            }
            "view" => {
                let q = Query {
                    epoch: frame.epoch.ok_or("bad_view")?,
                    id: frame.id.number.ok_or("bad_view")?,
                    now: frame.now.ok_or("bad_view")?,
                };
                if !safe(q.epoch) || !safe(q.id) || !safe(q.now) {
                    return Err("bad_view");
                }
                let line = self.state.line(q.now as f64);
                if line.0.len() > 4096 {
                    return Err("view_too_large");
                }
                Ok(Some(Reply::View {
                    protocol: 1,
                    epoch: self.epoch,
                    id: q.id,
                    line,
                    phase: self.state.phase.clone(),
                    failure: self.state.failure,
                    live: self.state.live(),
                    next_wake_at: self.state.next_wake(q.now as f64),
                }))
            }
            _ => Err("unknown_type"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[derive(Deserialize)]
    struct Golden {
        scenarios: Vec<Scenario>,
    }
    #[derive(Deserialize)]
    struct Scenario {
        locale: String,
        frames: Vec<Box<serde_json::value::RawValue>>,
        expect: std::collections::BTreeMap<String, (JsString, String, bool, bool, Option<f64>)>,
    }
    #[test]
    fn full_activity_golden() {
        let golden: Golden =
            serde_json::from_str(include_str!("../../../tests/fixtures/activity-golden.json"))
                .unwrap();
        let mut count = 0;
        for scenario in golden.scenarios {
            let mut worker = Worker::new(Data::load().unwrap());
            worker.handle(format!("{{\"protocol\":1,\"type\":\"hello\",\"version\":\"{VERSION}\",\"locale\":\"{}\"}}",scenario.locale).as_bytes()).unwrap();
            let mut views = std::collections::BTreeMap::new();
            for frame in scenario.frames {
                if let Some(Reply::View {
                    id,
                    line,
                    phase,
                    failure,
                    live,
                    next_wake_at,
                    ..
                }) = worker.handle(frame.get().as_bytes()).unwrap()
                {
                    views.insert(id.to_string(), (line, phase, failure, live, next_wake_at));
                }
            }
            for (id, expected) in scenario.expect {
                assert_eq!(views.get(&id), Some(&expected), "view id {id}");
                count += 1;
            }
        }
        assert_eq!(count, 1157);
    }
    #[test]
    fn whole_batch_validates_before_state_or_sequence_changes() {
        let mut w = Worker::new(Data::load().unwrap());
        w.handle(
            format!("{{\"protocol\":1,\"type\":\"hello\",\"version\":\"{VERSION}\"}}").as_bytes(),
        )
        .unwrap();
        w.handle(br#"{"protocol":1,"type":"event","epoch":1,"seq":0,"op":"reset"}"#)
            .unwrap();
        let bad=br#"{"protocol":1,"type":"event_batch","events":[{"type":"event","epoch":1,"seq":1,"op":"delta","now":1234,"local":[2026,4,17,5,12],"kind":"text_delta","text":"first"},{"type":"event","epoch":1,"seq":2,"op":"finish"}]}"#;
        assert_eq!(w.handle(bad).unwrap_err(), "bad_batch_event");
        assert_eq!(w.seq, 0);
        assert_eq!(w.state.phase, "idle");
        let valid=br#"{"protocol":1,"type":"event_batch","events":[{"type":"event","epoch":1,"seq":1,"op":"delta","now":1234,"local":[2026,4,17,5,12],"kind":"text_delta","text":"\u23f5 \ud800"}]}"#;
        w.handle(valid).unwrap();
        assert_eq!(w.seq, 1);
        assert_eq!(w.state.narration, JsString(vec![0xd800]));
        w.handle(valid).unwrap();
        assert_eq!(w.seq, 1);
    }
    #[test]
    fn compact_pack_is_atomic_bounded_and_preserves_local_text_sequence() {
        let mut w = Worker::new(Data::load().unwrap());
        w.handle(
            format!("{{\"protocol\":1,\"type\":\"hello\",\"version\":\"{VERSION}\"}}").as_bytes(),
        )
        .unwrap();
        w.handle(br#"{"protocol":1,"type":"event","epoch":1,"seq":0,"op":"reset"}"#)
            .unwrap();
        let bad=br#"{"protocol":1,"type":"delta_pack","groups":[{"epoch":1,"kind":"text_delta","local":[2026,4,17,5,12],"texts":["\u23f5 \ud800"],"rows":[[1,1000,0],[2,1001,99]]}]}"#;
        assert_eq!(w.handle(bad).unwrap_err(), "bad_pack");
        assert_eq!(w.seq, 0);
        assert_eq!(w.state.phase, "idle");
        let valid=br#"{"groups":[{"texts":["\u23f5 \ud800"],"rows":[[1,1000,0],[2,1001,0]],"epoch":1,"local":[2026,4,17,5,12],"kind":"text_delta"}],"type":"delta_pack","protocol":1}"#;
        w.handle(valid).unwrap();
        assert_eq!(w.seq, 2);
        assert_eq!(w.state.last_chunk, Some(1001.0));
        assert_eq!(w.state.narration, JsString(vec![0xd800]));
        w.handle(valid).unwrap();
        assert_eq!(w.seq, 2);
        let rows = (0..65)
            .map(|i| format!("[{},1002,0]", i + 3))
            .collect::<Vec<_>>()
            .join(",");
        let oversized=format!("{{\"protocol\":1,\"type\":\"delta_pack\",\"groups\":[{{\"epoch\":1,\"kind\":\"text_delta\",\"local\":[2026,4,17,5,12],\"texts\":[\"x\"],\"rows\":[{rows}]}}]}}");
        assert_eq!(w.handle(oversized.as_bytes()).unwrap_err(), "bad_pack");
        assert_eq!(w.seq, 2);
    }
    #[test]
    fn envelope_order_and_duplicate_fields_do_not_bypass_typed_validation() {
        let mut w = Worker::new(Data::load().unwrap());
        w.handle(
            format!("{{\"version\":\"{VERSION}\",\"type\":\"hello\",\"protocol\":1}}").as_bytes(),
        )
        .unwrap();
        assert!(w
            .handle(br#"{"protocol":1,"type":"event","epoch":1,"seq":0,"op":"reset","op":"begin"}"#)
            .is_err());
        assert_eq!(w.epoch, -1);
        w.handle(br#"{"op":"reset","seq":0,"epoch":1,"type":"event","protocol":1}"#)
            .unwrap();
        assert!(w
            .handle(br#"{"protocol":1,"type":"view","epoch":1,"id":"\ud800","now":1}"#)
            .is_err());
        assert!(w.handle(br#"{"protocol":1,"type":"event","epoch":1,"seq":1,"op":"toolStart","now":1,"local":[2026,4,17,5,12],"id":1,"name":"read"}"#).is_err());
        assert_eq!(w.seq, 0);
    }
    #[test]
    fn malformed_byte_and_text_budgets_never_repair_or_echo_content() {
        let mut w = Worker::new(Data::load().unwrap());
        let bad = vec![b'{', b'"', 0xed, 0xa0, 0x80, b'"', b':', b'0', b'}'];
        assert_eq!(w.handle(&bad).unwrap_err(), "bad_utf8");
        assert_eq!(
            w.handle(&vec![b'x'; MAX_FRAME + 1]).unwrap_err(),
            "frame_too_large"
        );
        let text = format!("\"{}\"", "a".repeat(65537));
        assert!(serde_json::from_str::<JsString>(&text).is_err());
        let report = serde_json::to_string(&w.error("bad_utf8")).unwrap();
        assert!(!report.contains("PRIVATE"));
    }
    #[test]
    fn rejects_invalid_and_old_frames() {
        let mut w = Worker::new(Data::load().unwrap());
        assert!(w.handle(b"{\"protocol\":1,\"type\":\"view\"}").is_err());
        w.handle(
            format!("{{\"protocol\":1,\"type\":\"hello\",\"version\":\"{VERSION}\"}}").as_bytes(),
        )
        .unwrap();
        w.handle(b"{\"protocol\":1,\"type\":\"event\",\"epoch\":1,\"seq\":1,\"op\":\"reset\"}")
            .unwrap();
        w.handle(b"{\"protocol\":1,\"type\":\"event\",\"epoch\":0,\"seq\":2,\"op\":\"reset\"}")
            .unwrap();
        assert_eq!(w.epoch, 1);
        assert!(w
            .handle(b"{\"protocol\":1,\"type\":\"event_batch\",\"events\":[]}")
            .is_err());
    }
}
