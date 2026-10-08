// Port of activity.ts. Data and mix_slot derive from dsh-working-activity (BSD-3-Clause).
// Copyright (c) 2026, chimney (ccch1mneyyy); see ../../../data/activity/LICENSE.
// Pure activity state: all clocks/calendar/identity are supplied by the host.
use crate::js_string::{cat, JsString};
use crate::text::{cut_columns, fragment, narration};
use serde::Deserialize;
use std::{collections::HashSet, sync::Arc};

pub type Pool = &'static [&'static [u16]];
pub struct Preset {
    pub frames: Pool,
    pub interval_ms: f64,
}
// Project-owned π preset; leave the 35 licensed/generated presets untouched.
const PI_REST: &[u16] = &[960, 32, 32, 32, 32];
static PI_PRESET: Preset = Preset {
    frames: &[
        &[960, 32, 183, 32, 32],
        &[960, 32, 183, 183, 32],
        &[960, 32, 183, 183, 183],
    ],
    interval_ms: 240.0,
};
pub struct Presets(pub &'static [(&'static str, Preset)]);
pub struct Tier {
    pub at_ms: f64,
    pub pool: Pool,
}
pub struct Action {
    pub words: &'static [&'static [u16]],
    pub anchored: bool,
    pub actions: Pool,
}
pub struct LanguageData {
    pub pools: &'static [(&'static str, Pool)],
    pub ui: &'static [(&'static str, &'static [u16])],
    pub holiday: &'static [(&'static str, Pool)],
    pub tiers: &'static [Tier],
    pub actions: &'static [Action],
}
mod generated {
    include!("assets.rs");
}
pub struct Data {
    pub presets: Presets,
}
impl Data {
    // No runtime JSON parsing or filesystem reads. Arc ownership is retained for snapshots.
    pub fn load() -> Result<Arc<Self>, std::convert::Infallible> {
        Ok(Arc::new(Self {
            presets: Presets(generated::PRESETS),
        }))
    }
    pub fn source_hashes() -> [&'static str; 2] {
        [generated::PHRASES_SHA256, generated::FRAMES_SHA256]
    }
    pub fn preset(&self, name: &str) -> &Preset {
        if name == "pi" {
            return &PI_PRESET;
        }
        &self.presets.0.iter().find(|(n, _)| *n == name).unwrap().1
    }
    fn language(&self, lang: &str) -> &'static LanguageData {
        if lang == "en" {
            &generated::EN
        } else {
            &generated::ZH
        }
    }
    fn pool(&self, name: &str, lang: &str) -> Pool {
        self.language(lang)
            .pools
            .iter()
            .find(|(key, _)| *key == name)
            .unwrap()
            .1
    }
    fn ui(&self, lang: &str, key: &str) -> JsString {
        JsString(
            self.language(lang)
                .ui
                .iter()
                .find(|(k, _)| *k == key)
                .unwrap()
                .1
                .to_vec(),
        )
    }
}
#[derive(Clone, Deserialize)]
#[serde(default)]
pub struct Config {
    pub enabled: bool,
    pub frames: String,
    pub lang: String,
    pub narrate: bool,
    pub contract: bool,
    pub phrases: bool,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            enabled: true,
            frames: "pi".into(),
            lang: "zh".into(),
            narrate: true,
            contract: true,
            phrases: true,
        }
    }
}
impl Config {
    fn normalized(mut self, data: &Data) -> Self {
        if self.frames != "random"
            && self.frames != "pi"
            && !data
                .presets
                .0
                .iter()
                .any(|(n, _)| *n == self.frames.as_str())
        {
            self.frames = "pi".into();
        }
        if !matches!(self.lang.as_str(), "zh" | "en" | "auto") {
            self.lang = "zh".into();
        }
        self
    }
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tool {
    pub id: JsString,
    pub name: JsString,
    pub action: JsString,
    pub detail: JsString,
    pub started_at: f64,
    #[serde(default)]
    pub ended_at: Option<f64>,
    #[serde(default)]
    pub error: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub config: Config,
    pub phase: String,
    pub started_at: f64,
    pub started_local: [i64; 5],
    pub phase_at: f64,
    pub thinking_phases: u64,
    pub active: Vec<Tool>,
    pub completed: u64,
    pub first_tool_at: Option<f64>,
    pub last_tool: Option<Tool>,
    pub narration: JsString,
    pub last_narration: JsString,
    pub last_chunk_at: Option<f64>,
    pub done_text: JsString,
    pub preset_name: String,
    pub end_at: Option<f64>,
    pub failure: bool,
    pub output_tokens: f64,
    pub seen_message_keys: Vec<JsString>,
}
pub fn mix_slot(seed: f64, slot: f64) -> u32 {
    fn to_u32(n: f64) -> u32 {
        if !n.is_finite() {
            return 0;
        }
        let n = n.trunc() % 4294967296.0;
        (if n < 0.0 { n + 4294967296.0 } else { n }) as u32
    }
    let mut h = to_u32(seed).wrapping_mul(0x9e3779b1) ^ to_u32(slot).wrapping_mul(0x85ebca6b);
    h = (h ^ (h >> 15)).wrapping_mul(0x2545f491);
    h = (h ^ (h >> 13)).wrapping_mul(0x9e3779b1);
    h ^ (h >> 16)
}
fn pick(pool: Pool, seed: f64, slot: f64) -> JsString {
    if pool.is_empty() {
        JsString::default()
    } else {
        JsString(pool[mix_slot(seed, slot) as usize % pool.len()].to_vec())
    }
}
pub fn duration(ms: f64) -> String {
    let s = (ms.max(0.0) / 1000.0).floor() as u64;
    if s < 60 {
        format!("{s}s")
    } else if s < 3600 {
        format!("{}m{}s", s / 60, s % 60)
    } else {
        format!("{}h{}m", s / 3600, s % 3600 / 60)
    }
}
// toFixed(1), positive finite values: round the exact binary rational, ties up.
pub fn fixed1(n: f64) -> String {
    if n >= 1e21 {
        return js_num(n);
    }
    if n == 0.0 {
        return "0.0".into();
    }
    let bits = n.to_bits();
    let exp = ((bits >> 52) & 2047) as i32 - 1023 - 52;
    let significand = ((bits & ((1u64 << 52) - 1)) | 1u64 << 52) as u128 * 10;
    let rounded = if exp >= 0 {
        significand << exp
    } else {
        let shift = (-exp) as u32;
        if shift >= 128 {
            0
        } else {
            let q = significand >> shift;
            let rem = significand & ((1u128 << shift) - 1);
            q + u128::from(rem >= 1u128 << (shift - 1))
        }
    };
    format!("{}.{}", rounded / 10, rounded % 10)
}
pub fn js_num(n: f64) -> String {
    if n.is_nan() {
        return "NaN".into();
    }
    if n.is_infinite() {
        return if n.is_sign_negative() {
            "-Infinity".into()
        } else {
            "Infinity".into()
        };
    }
    if n == 0.0 {
        return "0".into();
    }
    let raw = serde_json::to_string(&n).unwrap();
    let sign = if n < 0.0 { "-" } else { "" };
    let raw = raw.trim_start_matches('-');
    let (mantissa, exp) = raw
        .split_once('e')
        .map(|(m, e)| (m, e.parse::<i32>().unwrap()))
        .unwrap_or((raw, 0));
    let point = mantissa.find('.').unwrap_or(mantissa.len()) as i32 + exp;
    let mut digits = mantissa.replace('.', "");
    while digits.len() > 1 && digits.ends_with('0') {
        digits.pop();
    }
    let leading = digits.bytes().take_while(|b| *b == b'0').count();
    let point = point - leading as i32;
    digits = digits[leading..].to_string();
    if point > 0 && point <= 21 {
        if point as usize >= digits.len() {
            format!(
                "{sign}{digits}{}",
                "0".repeat(point as usize - digits.len())
            )
        } else {
            format!(
                "{sign}{}.{}",
                &digits[..point as usize],
                &digits[point as usize..]
            )
        }
    } else if point <= 0 && point > -6 {
        format!("{sign}0.{}{digits}", "0".repeat((-point) as usize))
    } else {
        let exponent = point - 1;
        format!(
            "{sign}{}{}e{}{exponent}",
            &digits[..1],
            if digits.len() > 1 {
                format!(".{}", &digits[1..])
            } else {
                String::new()
            },
            if exponent >= 0 { "+" } else { "" }
        )
    }
}

pub struct State {
    pub data: Arc<Data>,
    pub config: Config,
    pub locale: String,
    pub phase: String,
    pub started: f64,
    pub local: [i64; 5],
    pub phase_at: f64,
    pub thinking: u64,
    pub active: Vec<Tool>,
    pub completed: u64,
    pub first_tool: Option<f64>,
    pub last_tool: Option<Tool>,
    pub narration: JsString,
    pub last_narration: JsString,
    pub last_chunk: Option<f64>,
    pub done_text: JsString,
    pub end: Option<f64>,
    pub failure: bool,
    pub tokens: f64,
    pub seen: HashSet<JsString>,
    pub preset: String,
}
impl State {
    pub fn new(data: Arc<Data>, locale: String) -> Self {
        Self {
            data,
            config: Config::default(),
            locale,
            phase: "idle".into(),
            started: 0.0,
            local: [1970, 1, 1, 4, 0],
            phase_at: 0.0,
            thinking: 0,
            active: vec![],
            completed: 0,
            first_tool: None,
            last_tool: None,
            narration: JsString::default(),
            last_narration: JsString::default(),
            last_chunk: None,
            done_text: JsString::default(),
            end: None,
            failure: false,
            tokens: 0.0,
            seen: HashSet::new(),
            preset: "pi".into(),
        }
    }
    pub fn live(&self) -> bool {
        !matches!(self.phase.as_str(), "idle" | "done")
    }
    pub fn lang(&self) -> &str {
        if self.config.lang == "auto" {
            if self.locale.to_ascii_lowercase().starts_with("en") {
                "en"
            } else {
                "zh"
            }
        } else {
            &self.config.lang
        }
    }
    pub fn configure(&mut self, c: Config) {
        self.config = c.normalized(&self.data);
        self.preset = if self.config.frames == "random" {
            self.data.presets.0[mix_slot(self.started, 123.0) as usize % self.data.presets.0.len()]
                .0
                .to_owned()
        } else {
            self.config.frames.clone()
        };
    }
    pub fn reset(&mut self, c: Option<Config>) {
        let config = c.unwrap_or_else(|| self.config.clone());
        let data = self.data.clone();
        let locale = self.locale.clone();
        *self = Self::new(data, locale);
        self.configure(config);
    }
    pub fn phase(&mut self, p: &str, now: f64) {
        if self.phase != p {
            if p == "thinking" {
                self.thinking += 1;
            }
            self.phase = p.into();
            self.phase_at = now;
        }
    }
    pub fn begin(&mut self, now: f64, local: [i64; 5]) {
        self.reset(None);
        self.started = now;
        self.local = local;
        self.phase("waiting", now);
        self.configure(self.config.clone());
    }
    pub fn turn_start(&mut self, now: f64, local: [i64; 5]) {
        if !self.live() {
            self.begin(now, local);
        } else if self.active.is_empty() {
            self.stream_start(now, local);
        }
    }
    pub fn stream_start(&mut self, now: f64, local: [i64; 5]) {
        if !self.live() {
            self.begin(now, local);
        }
        self.narration = JsString::default();
        self.last_chunk = None;
        if self.active.is_empty() {
            self.phase("waiting", now);
        }
    }
    pub fn delta(&mut self, kind: &str, text: &JsString, now: f64, local: [i64; 5]) {
        if !self.live() {
            self.begin(now, local);
        }
        if self.active.is_empty() {
            self.phase("thinking", now);
        }
        self.last_chunk = Some(now);
        if self.config.narrate && kind.starts_with("text") {
            if let Some(s) = narration(text) {
                self.narration = s.clone();
                self.last_narration = s;
            }
        }
    }
    pub fn message_end(
        &mut self,
        text: &JsString,
        key: JsString,
        tokens: Option<f64>,
        now: f64,
        local: [i64; 5],
    ) {
        if !self.live() {
            self.begin(now, local);
        }
        if self.active.is_empty() {
            self.phase("thinking", now);
        }
        if self.config.narrate {
            if let Some(s) = narration(text) {
                self.narration = s.clone();
                self.last_narration = s;
                self.last_chunk = Some(now);
            }
        }
        if self.seen.insert(key) {
            if let Some(t) = tokens.filter(|t| t.is_finite() && *t >= 0.0) {
                self.tokens += t;
            }
        }
    }
    fn tool_action(&self, name: &JsString, slot: f64) -> JsString {
        let mut units = name.0.as_slice();
        for prefix in ["functions.", "tools."] {
            let p = prefix.encode_utf16().collect::<Vec<_>>();
            if units.starts_with(&p) {
                units = &units[p.len()..];
                break;
            }
        }
        let key = units
            .iter()
            .map(|u| if (65..=90).contains(u) { u + 32 } else { *u })
            .collect::<Vec<_>>();
        for row in self.data.language(self.lang()).actions {
            if row.words.iter().any(|word| {
                if row.anchored {
                    key.as_slice() == *word
                } else {
                    key.starts_with(word)
                }
            }) {
                return pick(row.actions, self.started, slot);
            }
        }
        pick(
            self.data.pool("toolFallback", self.lang()),
            self.started,
            slot,
        )
    }
    pub fn tool_start(
        &mut self,
        id: JsString,
        name: &JsString,
        detail: Option<&JsString>,
        now: f64,
        local: [i64; 5],
    ) {
        if !self.live() {
            self.begin(now, local);
        }
        if self.active.iter().any(|t| t.id == id) {
            return;
        }
        self.first_tool.get_or_insert(now);
        let name = fragment(name);
        let action = self.tool_action(&name, (self.completed as usize + self.active.len()) as f64);
        self.active.push(Tool {
            id,
            name,
            action,
            detail: detail
                .map(|s| cut_columns(&fragment(s), 40))
                .unwrap_or_default(),
            started_at: now,
            ended_at: None,
            error: false,
        });
        self.phase("tool", now);
    }
    pub fn tool_end(&mut self, id: &JsString, error: bool, now: f64) {
        if let Some(i) = self.active.iter().position(|t| t.id == *id) {
            let mut tool = self.active.remove(i);
            tool.ended_at = Some(now);
            tool.error = error;
            self.last_tool = Some(tool);
            self.failure = error;
            self.completed += 1;
            if self.active.is_empty() {
                self.phase("thinking", now);
            }
        }
    }
    pub fn finish(&mut self, now: f64, reason: &str) {
        if !self.live() {
            return;
        }
        self.end = Some(now);
        let lang = self.lang();
        let prefix = match reason {
            "aborted" => JsString::from(if lang == "zh" {
                "已中断"
            } else {
                "Interrupted"
            }),
            "error" => JsString::from(if lang == "zh" {
                "请求失败"
            } else {
                "Request failed"
            }),
            _ => {
                if self.config.phrases {
                    pick(
                        self.data
                            .pool(if self.failure { "fail" } else { "done" }, lang),
                        self.started,
                        11.0,
                    )
                } else {
                    self.data.ui(lang, "done-prefix")
                }
            }
        };
        let usage = if self.tokens != 0.0 {
            format!(
                " · ↓ {} tokens",
                if self.tokens >= 1000.0 {
                    format!("{}k", fixed1(self.tokens / 1000.0))
                } else {
                    js_num(self.tokens)
                }
            )
        } else {
            String::new()
        };
        self.done_text = cat(&[
            prefix,
            JsString::from(format!(
                " · {} {} · {}{}{}",
                self.completed,
                if lang == "zh" { "工具" } else { "tools" },
                if lang == "zh" { "总" } else { "total " },
                duration(now - self.started),
                usage
            )),
        ]);
        self.failure |= reason == "error";
        self.active.clear();
        self.phase("done", now);
    }
    fn rare(&self) -> bool {
        self.phase == "thinking"
            && self.thinking == 1
            && mix_slot(self.started, 0x5eed as f64) % 150 == 0
    }
    pub fn phrase(&self, now: f64) -> JsString {
        let lang = self.lang();
        if !self.config.phrases {
            return self.data.ui(
                lang,
                if self.phase == "waiting" {
                    "waiting-label"
                } else {
                    "thinking-label"
                },
            );
        }
        let rare = self.rare();
        let rotate = if rare { 7500.0 } else { 4000.0 };
        let slot = ((now - self.phase_at) / rotate).floor().max(0.0);
        if self.phase == "waiting" {
            return pick(self.data.pool("waiting", lang), self.started, slot);
        }
        if self.thinking == 1 && slot == 0.0 {
            let mmdd = format!("{:02}-{:02}", self.local[1], self.local[2]);
            let holiday =
                if generated::LUNAR_DAYS.contains(&format!("{}-{mmdd}", self.local[0]).as_str()) {
                    Some(self.data.pool("lunarNewYear", lang))
                } else {
                    self.data
                        .language(lang)
                        .holiday
                        .iter()
                        .find(|(key, _)| *key == mmdd)
                        .map(|(_, pool)| *pool)
                };
            if let Some(pool) = holiday {
                return pick(pool, self.started, slot);
            }
            if rare {
                return pick(self.data.pool("rare", lang), self.started, slot);
            }
            if matches!(self.local[3], 0 | 6) {
                return pick(self.data.pool("weekend", lang), self.started, slot);
            }
        }
        if rare {
            return pick(self.data.pool("rare", lang), self.started, slot);
        }
        let elapsed = self.phase_at + slot * rotate - self.started;
        if let Some(row) = self
            .data
            .language(lang)
            .tiers
            .iter()
            .rev()
            .find(|r| elapsed >= r.at_ms)
        {
            return pick(row.pool, self.started, slot);
        }
        let base = self.data.pool("thinking", lang);
        let night = self.data.pool("thinkingNight", lang);
        let count = base.len() + if self.local[4] < 6 { night.len() } else { 0 };
        let index = mix_slot(self.started, slot) as usize % count;
        JsString(
            if index < base.len() {
                base[index]
            } else {
                night[index - base.len()]
            }
            .to_vec(),
        )
    }
    pub fn frame(&self, now: f64) -> JsString {
        if !self.live() && self.preset == "pi" {
            return JsString(PI_REST.to_vec());
        }
        let preset = self.data.preset(&self.preset);
        if preset.frames.is_empty() {
            return JsString::default();
        }
        JsString(
            preset.frames[((now - self.started).max(0.0) / preset.interval_ms).floor() as usize
                % preset.frames.len()]
            .to_vec(),
        )
    }
    pub fn line(&self, now: f64) -> JsString {
        if !self.config.enabled {
            return JsString::default();
        }
        let lang = self.lang();
        let frame = if !self.live() && self.preset == "pi" {
            PI_REST
        } else if self.phase == "idle" {
            self.data
                .preset(&self.preset)
                .frames
                .first()
                .copied()
                .unwrap_or_default()
        } else {
            let preset = self.data.preset(&self.preset);
            let at = if self.phase == "done" {
                self.end.unwrap_or(self.started)
            } else {
                now
            };
            preset.frames[((at - self.started).max(0.0) / preset.interval_ms).floor() as usize
                % preset.frames.len()]
        };
        let mut out = JsString(Vec::with_capacity(256));
        out.0.extend_from_slice(frame);
        if self.phase == "idle" {
            out.push(if lang == "zh" {
                " ⏵ 待机中 · 等待任务"
            } else {
                " ⏵ Idle · ready for a task"
            });
            return out.into_trim();
        }
        if self.phase == "done" {
            out.push(" ⏵ ");
            if self.config.narrate && !self.last_narration.is_empty() {
                out.append(&self.last_narration);
                out.push(" · ");
            }
            out.append(&self.done_text);
            return out.into_trim();
        }
        out.push(" ");
        let has_narration = self.config.narrate
            && !self.narration.is_empty()
            && self.last_chunk.is_some_and(|t| now - t <= 5000.0);
        if let Some(tool) = self.active.last() {
            if has_narration {
                out.push("⏵ ");
                out.append(&self.narration);
                out.push(" · ");
            }
            if self.config.phrases && self.first_tool.is_some_and(|t| now - t < 2500.0) {
                out.append(&pick(
                    self.data.pool("toolOpening", lang),
                    self.started,
                    0.0,
                ));
                out.push(" · ");
            }
            out.append(&tool.action);
            out.push(" ");
            out.append(if tool.detail.is_empty() {
                &tool.name
            } else {
                &tool.detail
            });
            out.push(&format!(" · {}", duration(now - tool.started_at)));
            if self.active.len() > 1 {
                out.push(&format!(
                    " · {} {}",
                    self.active.len(),
                    if lang == "zh" { "并行" } else { "parallel" }
                ));
            }
        } else if let Some(tool) = self
            .last_tool
            .as_ref()
            .filter(|t| self.config.phrases && now - t.ended_at.unwrap() < 2500.0)
        {
            out.push("✓ ");
            out.append(&tool.action);
            out.push(" ");
            out.append(if tool.detail.is_empty() {
                &tool.name
            } else {
                &tool.detail
            });
            let ms = tool.ended_at.unwrap() - tool.started_at;
            out.push(&format!(
                " · {}",
                if ms < 1000.0 {
                    format!("{}ms", js_num(ms.floor()))
                } else {
                    duration(ms)
                }
            ));
        } else {
            if has_narration {
                out.push("⏵ ");
                out.append(&self.narration);
            } else {
                out.append(&self.phrase(now));
            }
            out.push(&format!(
                " · {}{}",
                if lang == "zh" { "总" } else { "total " },
                duration(now - self.started)
            ));
        }
        out.into_trim()
    }
    pub fn next_wake(&self, now: f64) -> Option<f64> {
        if !self.config.enabled || !self.live() {
            return None;
        }
        let preset = self.data.preset(&self.preset);
        let next = |anchor: f64, interval: f64| {
            anchor + (((now - anchor).max(0.0) / interval).floor() + 1.0) * interval
        };
        let mut candidates = vec![
            next(
                self.active
                    .last()
                    .map(|t| t.started_at)
                    .unwrap_or(self.started),
                1000.0,
            ),
            next(self.phase_at, if self.rare() { 7500.0 } else { 4000.0 }),
        ];
        if preset.frames.len() > 1 {
            candidates.push(next(self.started, preset.interval_ms.max(16.0)));
        }
        if let Some(t) = self.last_chunk.filter(|_| !self.narration.is_empty()) {
            candidates.push(t + 5001.0);
        }
        if let Some(tool) = &self.last_tool {
            candidates.push(tool.ended_at.unwrap() + 2500.0);
        }
        if let Some(t) = self.first_tool {
            candidates.push(t + 2500.0);
        }
        candidates
            .into_iter()
            .filter(|t| *t > now)
            .min_by(|a, b| a.total_cmp(b))
    }
    pub fn restore(&mut self, s: Snapshot) {
        self.reset(Some(s.config));
        self.phase = s.phase;
        self.started = s.started_at;
        self.local = s.started_local;
        self.phase_at = s.phase_at;
        self.thinking = s.thinking_phases;
        self.active = s.active;
        self.completed = s.completed;
        self.first_tool = s.first_tool_at;
        self.last_tool = s.last_tool;
        self.narration = s.narration;
        self.last_narration = s.last_narration;
        self.last_chunk = s.last_chunk_at;
        self.done_text = s.done_text;
        self.end = s.end_at;
        self.failure = s.failure;
        self.tokens = s.output_tokens;
        self.seen = s.seen_message_keys.into_iter().collect();
        self.preset = if s.preset_name == "pi"
            || self
                .data
                .presets
                .0
                .iter()
                .any(|(n, _)| *n == s.preset_name.as_str())
        {
            s.preset_name
        } else {
            "pi".into()
        };
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn numeric_js_edges() {
        assert_eq!(fixed1(1.25), "1.3");
        assert_eq!(fixed1(1.15), "1.1");
        assert_eq!(js_num(1e-6), "0.000001");
        assert_eq!(js_num(1e-7), "1e-7");
        assert_eq!(js_num(1e21), "1e+21");
        assert_eq!(js_num(12.5), "12.5");
    }
    #[test]
    fn pi_dots_have_fixed_width_and_static_rest_without_new_wakes() {
        let mut s = State::new(Data::load().unwrap(), "zh-CN".into());
        assert_eq!(s.config.frames, "pi");
        assert_eq!(s.line(0.0), s.line(99999.0));
        assert_eq!(s.next_wake(0.0), None);
        s.begin(1000.0, [2026, 4, 17, 5, 12]);
        for (i, frame) in ["π ·  ", "π ·· ", "π ···", "π ·  "].iter().enumerate() {
            assert_eq!(s.frame(1000.0 + i as f64 * 240.0), JsString::from(*frame));
            assert_eq!(s.frame(1000.0 + i as f64 * 240.0).0.len(), 5);
        }
        s.finish(1750.0, "");
        assert_eq!(s.frame(1750.0), JsString::from("π    "));
        assert_eq!(s.line(1750.0), s.line(99999.0));
        assert_eq!(s.next_wake(1750.0), None);
        s.configure(Config {
            frames: "moon8".into(),
            ..Config::default()
        });
        s.begin(2000.0, [2026, 4, 17, 5, 12]);
        assert_eq!(s.frame(2120.0), JsString::from("🌒"));
        s.configure(Config {
            frames: "random".into(),
            ..Config::default()
        });
        for now in [0.0, 1000.0, 123456.0] {
            s.begin(now, [2026, 4, 17, 5, 12]);
            assert_eq!(
                s.preset,
                s.data.presets.0[mix_slot(now, 123.0) as usize % 35].0
            );
        }
    }
    #[test]
    fn preset_order_is_not_a_sorted_map() {
        let d = Data::load().unwrap();
        assert_eq!(d.presets.0[0].0, "claude");
        assert_eq!(d.presets.0[13].0, "moon8");
        assert_eq!(d.presets.0.len(), 35);
    }
}
