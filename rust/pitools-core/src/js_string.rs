// UTF-16 protocol strings: preserve every JS code unit, including surrogates.
// No lossy conversion, bare-byte repair or intermediate serde_json::Value.
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::value::RawValue;
use std::fmt::Write;

#[derive(Clone, Debug, Default, PartialEq, Eq, Hash)]
pub struct JsString(pub Vec<u16>);
impl JsString {
    pub fn tail(&self, n: usize) -> Self {
        Self(self.0[self.0.len().saturating_sub(n)..].to_vec())
    }
    pub fn try_to_string(&self) -> Result<String, std::string::FromUtf16Error> {
        String::from_utf16(&self.0)
    }
    pub fn ascii_token(&self) -> String {
        escape_json_str(&self.0, true)
    }
    pub fn trim(&self) -> Self {
        let a = self
            .0
            .iter()
            .position(|u| !is_space(*u))
            .unwrap_or(self.0.len());
        let b = self
            .0
            .iter()
            .rposition(|u| !is_space(*u))
            .map(|i| i + 1)
            .unwrap_or(a);
        Self(self.0[a..b].to_vec())
    }
    pub fn push(&mut self, value: &str) {
        self.0.extend(value.encode_utf16());
    }
    pub fn append(&mut self, value: &Self) {
        self.0.extend_from_slice(&value.0);
    }
    pub fn into_trim(mut self) -> Self {
        let a = self
            .0
            .iter()
            .position(|u| !is_space(*u))
            .unwrap_or(self.0.len());
        let b = self
            .0
            .iter()
            .rposition(|u| !is_space(*u))
            .map(|i| i + 1)
            .unwrap_or(a);
        self.0.truncate(b);
        if a > 0 {
            self.0.drain(..a);
        }
        self
    }
    pub fn from_json_token(raw: &str) -> Result<Self, &'static str> {
        unescape_json_str(raw).map(Self)
    }
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
    pub fn starts_with(&self, s: &str) -> bool {
        self.0.starts_with(&s.encode_utf16().collect::<Vec<_>>())
    }
}

impl From<&str> for JsString {
    fn from(value: &str) -> Self {
        Self(value.encode_utf16().collect())
    }
}
impl From<String> for JsString {
    fn from(value: String) -> Self {
        Self::from(value.as_str())
    }
}
pub fn cat(parts: &[JsString]) -> JsString {
    let mut units = Vec::with_capacity(parts.iter().map(|s| s.0.len()).sum());
    for part in parts {
        units.extend_from_slice(&part.0);
    }
    JsString(units)
}
pub fn is_space(u: u16) -> bool {
    matches!(u, 0x09..=0x0d|0x20|0xa0|0x1680|0x2000..=0x200a|0x2028|0x2029|0x202f|0x205f|0x3000|0xfeff)
}

fn unescape_json_str(raw: &str) -> Result<Vec<u16>, &'static str> {
    let inner = raw
        .strip_prefix('"')
        .and_then(|s| s.strip_suffix('"'))
        .ok_or("not_a_json_string")?;
    let mut units = Vec::with_capacity(inner.len().min(65536));
    let mut chars = inner.chars();
    while let Some(c) = chars.next() {
        match c {
            '"' => return Err("unescaped_quote"),
            c if c < '\u{20}' => return Err("unescaped_control"),
            '\\' => match chars.next().ok_or("dangling_backslash")? {
                '"' => units.push(0x22),
                '\\' => units.push(0x5c),
                '/' => units.push(0x2f),
                'b' => units.push(8),
                'f' => units.push(12),
                'n' => units.push(10),
                'r' => units.push(13),
                't' => units.push(9),
                'u' => {
                    let mut unit = 0u16;
                    for _ in 0..4 {
                        let digit = chars.next().ok_or("short_unicode_escape")?;
                        if !digit.is_ascii_hexdigit() {
                            return Err("bad_unicode_escape");
                        }
                        unit = (unit << 4) | digit.to_digit(16).unwrap() as u16;
                    }
                    units.push(unit); // No surrogate-pair validation/conversion.
                }
                _ => return Err("bad_escape"),
            },
            c => {
                let mut buf = [0; 2];
                units.extend_from_slice(c.encode_utf16(&mut buf));
            }
        }
        if units.len() > 65536 {
            return Err("text_too_large");
        }
    }
    Ok(units)
}

fn escape_json_str(units: &[u16], ascii: bool) -> String {
    let mut out = String::with_capacity(units.len() + 2);
    out.push('"');
    for item in char::decode_utf16(units.iter().copied()) {
        match item {
            Ok('"') => out.push_str("\\\""),
            Ok('\\') => out.push_str("\\\\"),
            Ok('\n') => out.push_str("\\n"),
            Ok('\r') => out.push_str("\\r"),
            Ok('\t') => out.push_str("\\t"),
            Ok('\u{8}') => out.push_str("\\b"),
            Ok('\u{c}') => out.push_str("\\f"),
            Ok(c) if c < '\u{20}' => write!(out, "\\u{:04x}", c as u32).unwrap(),
            Ok(c) if ascii && c as u32 >= 0x7f => {
                let mut buf = [0; 2];
                for unit in c.encode_utf16(&mut buf) {
                    write!(out, "\\u{:04x}", unit).unwrap();
                }
            }
            Ok(c) => out.push(c),
            Err(e) => write!(out, "\\u{:04x}", e.unpaired_surrogate()).unwrap(),
        }
    }
    out.push('"');
    out
}
impl<'de> Deserialize<'de> for JsString {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        // Protocol always deserializes from a validated in-memory UTF-8 slice.
        // Borrow the raw token; no intermediate copy/allocation of its bytes.
        let raw: &'de RawValue = Deserialize::deserialize(d)?;
        unescape_json_str(raw.get())
            .map(Self)
            .map_err(serde::de::Error::custom)
    }
}
impl Serialize for JsString {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        RawValue::from_string(escape_json_str(&self.0, false))
            .map_err(serde::ser::Error::custom)?
            .serialize(s)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[derive(Debug, PartialEq, Deserialize, Serialize)]
    struct Frame {
        narration: JsString,
        text: JsString,
    }

    #[test]
    fn raw_value_capture_and_output_really_preserve_unpaired_surrogates() {
        for src in [
            r#""\ud83d""#,
            r#""abc\ud83d\ude00""#,
            r#""\ude00x""#,
            r#""旁白\ud83d""#,
        ] {
            let raw: Box<RawValue> = serde_json::from_str(src).unwrap();
            assert_eq!(raw.get(), src);
            let v: JsString = serde_json::from_slice(src.as_bytes()).unwrap();
            let back = serde_json::to_string(&v).unwrap();
            let v2: JsString = serde_json::from_str(&back).unwrap();
            assert_eq!(v, v2);
        }
        assert!(serde_json::from_str::<String>(r#""\ud83d""#).is_err());
        assert!(serde_json::from_str::<serde_json::Value>(r#""\ud83d""#).is_err());
    }
    #[test]
    fn nested_fields_use_raw_tokens_without_value_intermediate() {
        let src = r#"{"narration":"旁白\ud83d","text":"\ude00\ud800\ud800"}"#;
        let frame: Frame = serde_json::from_str(src).unwrap();
        assert_eq!(frame.narration.0, vec![0x65c1, 0x767d, 0xd83d]);
        assert_eq!(frame.text.0, vec![0xde00, 0xd800, 0xd800]);
        let json = serde_json::to_vec(&frame).unwrap();
        assert_eq!(frame, serde_json::from_slice(&json).unwrap());
    }
    #[test]
    fn tail_is_code_units_not_chars_or_utf8_bytes() {
        let v: JsString = serde_json::from_str(r#""a\ud83d\ude00""#).unwrap();
        assert_eq!(v.tail(1).0, vec![0xde00]);
        assert_eq!(v.tail(0).0, Vec::<u16>::new());
        assert_eq!(v.tail(99), v);
        assert_eq!(v.tail(2).try_to_string().unwrap(), "😀");
        assert!(v.tail(1).try_to_string().is_err());
        let v: JsString = serde_json::from_str(&format!("\"😀{}\"", "a".repeat(300))).unwrap();
        assert_eq!(v.tail(301).0[0], 0xde00);
    }
    #[test]
    fn all_65536_single_units_roundtrip_without_replacement() {
        for unit in 0..=u16::MAX {
            let v = JsString(vec![unit]);
            let json = serde_json::to_string(&v).unwrap();
            assert_eq!(serde_json::from_str::<JsString>(&json).unwrap(), v);
            assert_eq!(
                serde_json::from_str::<JsString>(&v.ascii_token()).unwrap(),
                v
            );
        }
    }
    #[test]
    fn deterministic_random_sequences_roundtrip() {
        let mut seed = 42u32;
        for size in 0..512 {
            let mut units = Vec::new();
            for _ in 0..size {
                seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
                units.push((seed >> 8) as u16);
            }
            let v = JsString(units);
            let json = serde_json::to_vec(&v).unwrap();
            assert_eq!(serde_json::from_slice::<JsString>(&json).unwrap(), v);
        }
    }
    #[test]
    fn malformed_escapes_and_non_strings_are_not_repaired() {
        for src in [
            r#""\uD83""#,
            r#""\u+123""#,
            r#""\uZZZZ""#,
            r#""\q""#,
            r#""a"b""#,
            "\"a\n\"",
            "42",
            "null",
            "{}",
        ] {
            assert!(
                serde_json::from_str::<JsString>(src).is_err(),
                "accepted malformed input"
            );
        }
        assert!(unescape_json_str(r#""\u123""#).is_err());
        assert!(unescape_json_str(r#""a"b""#).is_err());
    }
    #[test]
    fn bare_wtf8_is_not_the_normal_protocol() {
        let raw = vec![b'"', 0xed, 0xa0, 0xbd, b'"'];
        assert!(std::str::from_utf8(&raw).is_err());
        assert!(serde_json::from_slice::<JsString>(&raw).is_err());
    }
    #[test]
    fn ascii_token_matches_python_style_for_controls_and_supplementary_text() {
        let v = JsString(vec![
            0, 8, 9, 10, 12, 13, 0x22, 0x5c, 0x7f, 0x65c1, 0x767d, 0xd83d, 0xde00, 0xd800,
        ]);
        assert_eq!(
            v.ascii_token(),
            r#""\u0000\b\t\n\f\r\"\\\u007f\u65c1\u767d\ud83d\ude00\ud800""#
        );
    }
}
