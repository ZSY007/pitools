// JS-compatible operations on UTF-16. No conversion of free text to Rust String.
use crate::js_string::{is_space, JsString};
use crate::marks::MARK_RANGES;

fn strip_osc(units: &[u16]) -> Vec<u16> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < units.len() {
        if units[i] == 27 && units.get(i + 1) == Some(&93) {
            let mut j = i + 2;
            let mut end = None;
            while j < units.len() {
                if units[j] == 7 {
                    end = Some(j + 1);
                    break;
                }
                if units[j] == 27 && units.get(j + 1) == Some(&92) {
                    end = Some(j + 2);
                    break;
                }
                j += 1;
            }
            if let Some(j) = end {
                i = j;
                continue;
            }
        }
        out.push(units[i]);
        i += 1;
    }
    out
}
fn strip_csi(units: &[u16]) -> Vec<u16> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < units.len() {
        if units[i] == 27 && units.get(i + 1) == Some(&91) {
            let mut j = i + 2;
            while j < units.len() && (0x30..=0x3f).contains(&units[j]) {
                j += 1;
            }
            while j < units.len() && (0x20..=0x2f).contains(&units[j]) {
                j += 1;
            }
            if j < units.len() && (0x40..=0x7e).contains(&units[j]) {
                i = j + 1;
                continue;
            }
        }
        out.push(units[i]);
        i += 1;
    }
    out
}
pub fn fragment(value: &JsString) -> JsString {
    let first = strip_osc(&value.0);
    let second = strip_csi(&first);
    let mut out = Vec::new();
    let mut spaced = false;
    for u in second {
        let u = if u <= 31 || (0x7f..=0x9f).contains(&u) {
            32
        } else {
            u
        };
        if (0x200b..=0x200f).contains(&u)
            || (0x2028..=0x202e).contains(&u)
            || (0x2060..=0x2069).contains(&u)
        {
            continue;
        }
        if is_space(u) {
            if !spaced {
                out.push(32);
            }
            spaced = true;
        } else {
            out.push(u);
            spaced = false;
        }
    }
    JsString(out).trim()
}
fn mark(point: u32) -> bool {
    let i = MARK_RANGES.partition_point(|&(_, b)| b < point);
    i < MARK_RANGES.len() && MARK_RANGES[i].0 <= point
}
fn wide(p: u32) -> bool {
    p >= 0x1100
        && (p <= 0x115f
            || (0x2e80..=0xa4cf).contains(&p)
            || (0xac00..=0xd7a3).contains(&p)
            || (0xf900..=0xfaff).contains(&p)
            || (0xfe10..=0xfe6f).contains(&p)
            || (0xff01..=0xff60).contains(&p)
            || (0xffe0..=0xffe6).contains(&p)
            || (0x1f000..=0x1faff).contains(&p)
            || p >= 0x20000)
}
pub fn cut_columns(text: &JsString, budget: usize) -> JsString {
    let mut i = 0;
    let mut columns = 0;
    while i < text.0.len() {
        let first = text.0[i];
        let pair = (0xd800..=0xdbff).contains(&first)
            && text
                .0
                .get(i + 1)
                .is_some_and(|u| (0xdc00..=0xdfff).contains(u));
        let (point, size) = if pair {
            (
                0x10000 + (((first - 0xd800) as u32) << 10) + (text.0[i + 1] - 0xdc00) as u32,
                2,
            )
        } else {
            (first as u32, 1)
        };
        let width = if mark(point) || point == 0x200d {
            0
        } else if wide(point) {
            2
        } else {
            1
        };
        if columns + width > budget {
            break;
        }
        columns += width;
        i += size;
    }
    JsString(text.0[..i].to_vec())
}
pub fn narration(text: &JsString) -> Option<JsString> {
    let start = text.0.len().saturating_sub(300);
    let units = &text.0[start..];
    let mut found = None;
    let mut i = 0;
    while i < units.len() {
        if units[i] == 0x23f5 && (i == 0 || units[i - 1] == 10) {
            let mut a = i + 1;
            while a < units.len() && matches!(units[a], 32 | 9) {
                a += 1;
            }
            let mut b = a;
            while b < units.len() && !matches!(units[b], 10 | 0x23f5) {
                b += 1;
            }
            // JS match.index includes the consumed LF, not just the marker.
            // Preserve even the legacy rolling-boundary exclusion exactly.
            let match_index = if i > 0 { i - 1 } else { 0 };
            if !(match_index == 0 && start > 0 && text.0[start - 1] != 10) {
                found = Some(JsString(units[a..b].to_vec()));
            }
            i = b;
        } else {
            i += 1;
        }
    }
    let mut clean = fragment(&found?);
    for i in 0..clean.0.len() {
        let u = clean.0[i];
        let dot = u == 46
            && (i + 1 == clean.0.len()
                || is_space(clean.0[i + 1])
                || ((65..=90).contains(&clean.0[i + 1])
                    && clean.0.get(i + 2).is_some_and(|u| (97..=122).contains(u))));
        if matches!(u, 0x3002 | 0xff0e | 33 | 63 | 0xff01 | 0xff1f | 59 | 0xff1b) || dot {
            clean.0.truncate(i + 1);
            break;
        }
    }
    clean = cut_columns(&clean, 80);
    while clean.0.last().is_some_and(|u| {
        matches!(
            u,
            0x3002 | 0xff0e | 46 | 33 | 0xff01 | 44 | 0xff0c | 0x3001 | 59 | 0xff1b
        )
    }) {
        clean.0.pop();
    }
    clean = clean.trim();
    if clean.is_empty() {
        None
    } else {
        Some(clean)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn utf16_narration_is_lossless_and_line_start_only() {
        let s = JsString(vec![10, 0x23f5, 32, 0xd800]);
        assert_eq!(narration(&s), Some(JsString(vec![0xd800])));
        assert_eq!(narration(&JsString::from("inline ⏵ no")), None);
        assert_eq!(
            narration(&JsString::from("⏵ Mr.Smith. Done")),
            Some(JsString::from("Mr"))
        );
        assert_eq!(
            narration(&JsString::from("⏵ 第一件\n⏵ 第二件。后续")),
            Some(JsString::from("第二件"))
        );
    }
    #[test]
    fn rolling_lf_boundary_preserves_legacy_match_index_exclusion() {
        assert_eq!(
            narration(&JsString::from(format!("x\n⏵ {}", "a".repeat(297)))),
            None
        );
    }
    #[test]
    fn escape_cleanup_matches_ts() {
        assert_eq!(
            fragment(&JsString::from(
                "\x1b]52;c;secret\x07\x1b[31m红色\x1b[0m\t路径"
            )),
            JsString::from("红色 路径")
        );
    }
}
