// Single-pass typed envelope. No serde tagged/flattened Content/Value intermediates.
// All free-text fields decode directly into JsString; the polymorphic ID borrows its token.
use crate::{
    activity::{Config, Snapshot},
    js_string::JsString,
    protocol::Event,
};
use serde::{Deserialize, Deserializer};
use serde_json::value::RawValue;

#[derive(Default)]
pub struct Id {
    pub text: Option<JsString>,
    pub number: Option<i64>,
}
impl<'de> Deserialize<'de> for Id {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let raw: &'de RawValue = Deserialize::deserialize(d)?;
        if raw.get().starts_with('"') {
            Ok(Self {
                text: Some(JsString::from_json_token(raw.get()).map_err(serde::de::Error::custom)?),
                number: None,
            })
        } else {
            Ok(Self {
                text: None,
                number: Some(serde_json::from_str(raw.get()).map_err(serde::de::Error::custom)?),
            })
        }
    }
}
#[derive(Deserialize)]
pub struct Pack {
    pub epoch: i64,
    pub kind: String,
    pub local: [i64; 5],
    pub texts: Vec<JsString>,
    pub rows: Vec<(i64, i64, usize)>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Frame {
    pub protocol: u8,
    #[serde(rename = "type")]
    pub frame_type: String,
    pub version: Option<String>,
    pub locale: Option<String>,
    pub epoch: Option<i64>,
    pub seq: Option<i64>,
    pub op: Option<String>,
    pub now: Option<i64>,
    pub local: Option<[i64; 5]>,
    pub config: Option<Config>,
    pub state: Option<Snapshot>,
    pub kind: Option<String>,
    pub text: Option<JsString>,
    pub message_key: Option<JsString>,
    pub output_tokens: Option<f64>,
    #[serde(default)]
    pub id: Id,
    pub name: Option<JsString>,
    pub detail: Option<JsString>,
    pub error: Option<bool>,
    pub reason: Option<String>,
    pub events: Option<Vec<Event>>,
    pub groups: Option<Vec<Pack>>,
}
impl Frame {
    pub fn event(self) -> Result<Event, &'static str> {
        Ok(Event {
            kind_frame: self.frame_type,
            epoch: self.epoch.ok_or("bad_event")?,
            seq: self.seq.ok_or("bad_event")?,
            op: self.op.ok_or("bad_event")?,
            now: self.now,
            local: self.local,
            config: self.config,
            state: self.state,
            kind: self.kind,
            text: self.text,
            message_key: self.message_key,
            output_tokens: self.output_tokens,
            id: self.id.text,
            name: self.name,
            detail: self.detail,
            error: self.error,
            reason: self.reason,
        })
    }
}
