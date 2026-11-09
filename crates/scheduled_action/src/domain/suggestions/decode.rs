//! Checking what a suggestion session hands back, before it is kept.
//!
//! The session reads the person's inbox, which anyone can write to, so what
//! it hands back is untrusted. A catalog pick names a catalog routine and
//! fills its knobs with short, bounded values; its trigger, steps and
//! whether it may be switched on by default always come from the catalog. A
//! drafted routine passes saving's checks and is kept switched off, never
//! acting as the person, for them to review before it is saved. A reason is
//! one plain line that names no address.

use std::collections::HashSet;

use routine_program::{CatalogRoutine, Knob, Surface, catalog_routine, limits};
use serde_json::{Map, Value};

use super::model::{CheckedSuggestion, StoredPick};
use crate::domain::models::ActionConfiguration;

#[cfg(test)]
mod test;

/// Longest reason shown, in characters.
pub const MAX_REASON_CHARS: usize = 160;
/// Longest text knob value AI may set, in characters: a label, tag or
/// channel name, never instructions.
pub const MAX_TEXT_KNOB_CHARS: usize = 60;
/// Most surfaces one suggestion shows on.
pub const MAX_SURFACES: usize = 3;

/// A catalog pick, checked: the catalog routine and the knob values that
/// fit it, or what is wrong with it.
pub fn catalog_pick(
    key: &str,
    knobs: Map<String, Value>,
    reason: &str,
    surfaces: Vec<Surface>,
    keep_probability: f32,
    allowed: &[Surface],
) -> Result<CheckedSuggestion, Vec<String>> {
    let mut problems = Vec::new();
    let routine = catalog_routine(key.trim());
    if routine.is_none() {
        problems.push(format!("`{key}` isn't a catalog routine"));
    }
    let knobs = routine
        .map(|routine| knob_values(routine, knobs, &mut problems))
        .unwrap_or_default();
    let common = common(reason, surfaces, keep_probability, allowed, &mut problems);
    match (routine, common, problems.is_empty()) {
        (Some(routine), Some((reason, surfaces, keep_probability)), true) => {
            Ok(CheckedSuggestion {
                surfaces,
                reason,
                keep_probability,
                pick: StoredPick::Catalog {
                    key: routine.key.to_owned(),
                    knobs,
                },
            })
        }
        _ => Err(problems),
    }
}

/// A drafted routine whose check passed, checked as a suggestion: kept
/// switched off, never acting as the person.
pub fn drafted_pick(
    mut routine: ActionConfiguration,
    reason: &str,
    surfaces: Vec<Surface>,
    keep_probability: f32,
    allowed: &[Surface],
) -> Result<CheckedSuggestion, Vec<String>> {
    let mut problems = Vec::new();
    if routine
        .task
        .get("dangerously_operate_as_user")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        problems.push(
            "a suggested routine never acts as the user; leave `dangerouslyOperateAsUser` out"
                .to_owned(),
        );
    }
    let common = common(reason, surfaces, keep_probability, allowed, &mut problems);
    match (common, problems.is_empty()) {
        (Some((reason, surfaces, keep_probability)), true) => {
            routine.enabled = false;
            Ok(CheckedSuggestion {
                surfaces,
                reason,
                keep_probability,
                pick: StoredPick::Routine { routine },
            })
        }
        _ => Err(problems),
    }
}

/// The reason, surfaces and estimate every suggestion has, checked.
fn common(
    reason: &str,
    surfaces: Vec<Surface>,
    keep_probability: f32,
    allowed: &[Surface],
    problems: &mut Vec<String>,
) -> Option<(String, Vec<Surface>, f32)> {
    let reason = match line(reason, MAX_REASON_CHARS) {
        Some(reason) if names_an_address(&reason) => {
            problems.push("the reason must not name an email address".to_owned());
            None
        }
        Some(reason) => Some(reason),
        None => {
            problems.push(format!(
                "the reason must be one plain line of at most {MAX_REASON_CHARS} characters"
            ));
            None
        }
    };
    let mut seen = HashSet::new();
    let surfaces: Vec<Surface> = surfaces
        .into_iter()
        .filter(|surface| seen.insert(*surface))
        .collect();
    if surfaces.is_empty() || surfaces.len() > MAX_SURFACES {
        problems.push(format!("give 1 to {MAX_SURFACES} surfaces"));
    }
    if let Some(surface) = surfaces.iter().find(|surface| !allowed.contains(surface)) {
        problems.push(format!(
            "this session suggests for {}, not {}",
            names(allowed),
            names(&[*surface])
        ));
    }
    if !keep_probability.is_finite() || !(0.0..=1.0).contains(&keep_probability) {
        problems.push("`keepProbability` is between 0 and 1".to_owned());
    }
    reason
        .filter(|_| problems.is_empty())
        .map(|reason| (reason, surfaces, keep_probability))
}

fn names(surfaces: &[Surface]) -> String {
    surfaces
        .iter()
        .filter_map(|surface| serde_json::to_value(surface).ok())
        .filter_map(|value| value.as_str().map(str::to_owned))
        .collect::<Vec<_>>()
        .join(", ")
}

/// The values set that fit `routine`'s knobs; one that doesn't is a
/// problem.
fn knob_values(
    routine: &CatalogRoutine,
    raw: Map<String, Value>,
    problems: &mut Vec<String>,
) -> Map<String, Value> {
    let knobs = routine
        .code
        .as_ref()
        .map(|code| code.knobs.as_slice())
        .unwrap_or_default();
    let mut values = Map::new();
    for (name, value) in raw {
        match knobs.iter().find(|knob| knob.name().as_str() == name) {
            None => problems.push(format!("`{}` has no knob `{name}`", routine.key)),
            Some(knob) => match fit(knob, &value) {
                Some(value) => {
                    values.insert(name, value);
                }
                None => problems.push(format!(
                    "`{name}` doesn't fit its knob: a text knob is a name of at most \
                     {MAX_TEXT_KNOB_CHARS} characters, a question ends with ?, a number \
                     stays in range, a choice is one of its options"
                )),
            },
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

/// Whether `text` holds something shaped like an email address.
fn names_an_address(text: &str) -> bool {
    text.split(|c: char| c.is_whitespace() || matches!(c, '<' | '>' | '(' | ')' | ',' | ';'))
        .any(|word| {
            word.split_once('@').is_some_and(|(local, domain)| {
                !local.is_empty() && domain.contains('.') && !domain.starts_with('.')
            })
        })
}

/// `text` trimmed, when it is one line of at most `max` characters with no
/// control or formatting characters.
pub(super) fn line(text: &str, max: usize) -> Option<String> {
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
