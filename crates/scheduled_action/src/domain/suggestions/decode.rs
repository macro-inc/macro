//! Turning AI's answer into suggestions the scheduler trusts.
//!
//! AI reads the person's inbox, which anyone can write to, so its answer is
//! untrusted. It may only pick catalog routines and fill their knobs with
//! short, bounded values, or describe a request the drafter writes when the
//! person accepts it. Everything else it says is dropped: a routine's trigger,
//! steps and whether it is safe to switch on by default always come from the
//! catalog.

use std::collections::{HashMap, HashSet};

use routine_program::{CatalogRoutine, Knob, Surface, limits};
use serde::Deserialize;
use serde_json::{Map, Value, json};

use super::model::{CheckedSuggestion, SuggestionPick};

#[cfg(test)]
mod test;

/// Suggestions kept per surface, best first.
pub const MAX_PER_SURFACE: usize = 3;
/// Longest reason shown, in characters.
pub const MAX_REASON_CHARS: usize = 160;
/// Longest text knob value AI may set, in characters: a label, tag or
/// channel name, never instructions.
pub const MAX_TEXT_KNOB_CHARS: usize = 60;
/// Longest request title, in characters.
pub const MAX_TITLE_CHARS: usize = 80;
/// Longest request, in characters.
pub const MAX_REQUEST_CHARS: usize = 300;

/// AI's answer, every field optional so one malformed suggestion drops only
/// itself.
#[derive(Debug, Default, Deserialize)]
pub struct RawAnswer {
    #[serde(default)]
    pub suggestions: Vec<Value>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawSuggestion {
    kind: Option<String>,
    key: Option<String>,
    #[serde(default)]
    knobs: Vec<RawKnob>,
    surface: Option<String>,
    title: Option<String>,
    request: Option<String>,
    reason: Option<String>,
    keep_probability: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct RawKnob {
    name: String,
    value: Value,
}

/// The JSON schema AI answers in.
pub fn answer_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["suggestions"],
        "properties": {
            "suggestions": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["kind", "key", "knobs", "surface", "title", "request", "reason", "keepProbability"],
                    "properties": {
                        "kind": { "type": "string", "enum": ["starter", "request"] },
                        "key": { "type": "string", "description": "starter: the catalog routine's key; request: empty" },
                        "knobs": {
                            "type": "array",
                            "description": "starter: knob values to change from the catalog's; request: empty",
                            "items": {
                                "type": "object",
                                "additionalProperties": false,
                                "required": ["name", "value"],
                                "properties": {
                                    "name": { "type": "string" },
                                    "value": { "type": ["string", "number", "boolean"] },
                                },
                            },
                        },
                        "surface": { "type": "string", "description": "request: where it belongs; starter: empty" },
                        "title": { "type": "string", "description": "request: its name; starter: empty" },
                        "request": { "type": "string", "description": "request: what it does and when, in the person's words; starter: empty" },
                        "reason": { "type": "string" },
                        "keepProbability": { "type": "number" },
                    },
                },
            },
        },
    })
}

/// What a decoded answer dropped, for the generation's span.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct Dropped {
    /// Suggestions that weren't usable at all.
    pub suggestions: usize,
    /// Knob values that didn't fit and kept the catalog's.
    pub knob_values: usize,
}

/// What the person said they're not interested in: catalog keys, and
/// requests by their text, compared without case.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct Dismissed {
    keys: HashSet<String>,
    requests: HashSet<String>,
}

impl Dismissed {
    pub fn new(picks: &[SuggestionPick]) -> Self {
        let mut dismissed = Self::default();
        for pick in picks {
            match pick {
                SuggestionPick::Starter { key, .. } => {
                    dismissed.keys.insert(key.clone());
                }
                SuggestionPick::Request { request, .. } => {
                    dismissed.requests.insert(request.to_lowercase());
                }
            }
        }
        dismissed
    }
}

/// The usable suggestions in `answer`, best first per surface, from
/// `offered` catalog routines only. What was `dismissed` is never suggested
/// again.
pub fn decode(
    answer: RawAnswer,
    offered: &[&CatalogRoutine],
    dismissed: &Dismissed,
) -> (Vec<CheckedSuggestion>, Dropped) {
    let offered: HashMap<&str, &CatalogRoutine> = offered
        .iter()
        .map(|routine| (routine.key, *routine))
        .collect();
    let mut dropped = Dropped::default();
    let mut per_surface: HashMap<Surface, usize> = HashMap::new();
    let mut seen_keys = HashSet::new();
    let mut seen_requests = dismissed.requests.clone();
    let mut checked = Vec::new();
    for value in answer.suggestions {
        let suggestion = serde_json::from_value::<RawSuggestion>(value)
            .ok()
            .and_then(|raw| check(raw, &offered, &mut dropped.knob_values));
        let Some(suggestion) = suggestion else {
            dropped.suggestions += 1;
            continue;
        };
        let fresh = match &suggestion.pick {
            SuggestionPick::Starter { key, .. } => {
                !dismissed.keys.contains(key) && seen_keys.insert(key.clone())
            }
            SuggestionPick::Request { request, .. } => seen_requests.insert(request.to_lowercase()),
        };
        let count = per_surface.entry(suggestion.surface).or_default();
        if !fresh || *count >= MAX_PER_SURFACE {
            dropped.suggestions += 1;
            continue;
        }
        *count += 1;
        checked.push(suggestion);
    }
    (checked, dropped)
}

fn check(
    raw: RawSuggestion,
    offered: &HashMap<&str, &CatalogRoutine>,
    dropped_knobs: &mut usize,
) -> Option<CheckedSuggestion> {
    let reason = line(raw.reason.as_deref()?, MAX_REASON_CHARS)?;
    let keep_probability = raw
        .keep_probability
        .filter(|p| p.is_finite())?
        .clamp(0.0, 1.0);
    let (surface, pick) = match raw.kind.as_deref()? {
        "starter" => {
            let routine = offered.get(raw.key.as_deref()?.trim())?;
            let knobs = knob_values(routine, raw.knobs, dropped_knobs);
            let pick = SuggestionPick::Starter {
                key: routine.key.to_owned(),
                knobs,
            };
            (routine.surface, pick)
        }
        "request" => {
            let surface =
                serde_json::from_value(Value::String(raw.surface?.trim().to_owned())).ok()?;
            let pick = SuggestionPick::Request {
                title: line(raw.title.as_deref()?, MAX_TITLE_CHARS)?,
                request: line(raw.request.as_deref()?, MAX_REQUEST_CHARS)?,
            };
            (surface, pick)
        }
        _ => return None,
    };
    Some(CheckedSuggestion {
        surface,
        reason,
        keep_probability: keep_probability as f32,
        pick,
    })
}

/// The values AI set that fit `routine`'s knobs. A value for a knob the
/// routine doesn't have, or one that doesn't fit, is dropped and the knob
/// keeps the catalog's value.
fn knob_values(
    routine: &CatalogRoutine,
    raw: Vec<RawKnob>,
    dropped: &mut usize,
) -> Map<String, Value> {
    let knobs = routine
        .code
        .as_ref()
        .map(|code| code.knobs.as_slice())
        .unwrap_or_default();
    let mut values = Map::new();
    for RawKnob { name, value } in raw {
        let fitted = knobs
            .iter()
            .find(|knob| knob.name().as_str() == name)
            .and_then(|knob| fit(knob, &value));
        match fitted {
            Some(value) => {
                values.insert(name, value);
            }
            None => *dropped += 1,
        }
    }
    values
}

/// `value` as `knob` takes it, or none when it doesn't fit.
fn fit(knob: &Knob, value: &Value) -> Option<Value> {
    match knob {
        Knob::Text { .. } => line(value.as_str()?, MAX_TEXT_KNOB_CHARS).map(Value::String),
        Knob::Question { .. } => {
            let question = line(value.as_str()?, limits::MAX_QUESTION_CHARS)?;
            question.ends_with('?').then_some(Value::String(question))
        }
        Knob::Number { min, max, .. } => {
            let number = value.as_f64().filter(|n| n.is_finite())?;
            let fits = min.is_none_or(|min| number >= min) && max.is_none_or(|max| number <= max);
            fits.then(|| serde_json::Number::from_f64(number).map(Value::Number))
                .flatten()
        }
        Knob::Boolean { .. } => value.as_bool().map(Value::Bool),
        Knob::Choice { options, .. } => {
            let choice = value.as_str()?;
            options
                .iter()
                .any(|option| option == choice)
                .then(|| Value::String(choice.to_owned()))
        }
    }
}

/// `text` trimmed, when it is one line of at most `max` characters with no
/// control or formatting characters.
fn line(text: &str, max: usize) -> Option<String> {
    let text = text.trim();
    let plain = !text.is_empty()
        && text.chars().count() <= max
        && !text.chars().any(|c| c.is_control() || is_invisible(c));
    plain.then(|| text.to_owned())
}

/// Characters that change how text displays without showing: bidirectional
/// overrides and zero-width characters.
fn is_invisible(c: char) -> bool {
    matches!(c, '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2060}'..='\u{2064}' | '\u{2066}'..='\u{2069}' | '\u{FEFF}')
}
