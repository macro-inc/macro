//! Checking what a generation session writes, before it is stored.
//!
//! The session reads the person's workspace, which other people write to,
//! so what it writes is untrusted. Every text is plain (no control or
//! invisible characters) and bounded, and names no email address, phone
//! number or street address ([`shown_text::personal_detail`]): items are
//! named by target, never copied into words. Each problem is a sentence the
//! session can act on.

use std::collections::HashSet;

use shown_text::{is_invisible, line, personal_detail};

use super::model::{Category, KindName, NewKind, SuggestIdea, Target};

#[cfg(test)]
mod test;

/// Longest dedup key, in characters.
pub const MAX_DEDUP_KEY_CHARS: usize = 120;
/// Longest title, in characters.
pub const MAX_TITLE_CHARS: usize = 80;
/// Longest summary, in characters.
pub const MAX_SUMMARY_CHARS: usize = 400;
/// Longest prompt, in characters.
pub const MAX_PROMPT_CHARS: usize = 2000;
/// Longest change-log reason, in characters.
pub const MAX_REASON_CHARS: usize = 300;
/// Most characters in what a background run posts or sends.
pub const MAX_SENDS_CHARS: usize = 200;
/// Most items one idea is about.
pub const MAX_TARGETS: usize = 5;
/// Longest item or part id, in characters.
const MAX_ID_CHARS: usize = 200;

/// A new idea's kind, from what the session asked for.
pub fn new_kind(request: &SuggestIdea, problems: &mut Vec<String>) -> Option<NewKind> {
    match request.kind {
        KindName::Routine => {
            problems.push(
                "suggestions sessions can't add routine suggestions; a routine suggestion comes from \
                 `macro.routines.suggest` in a routines session"
                    .to_owned(),
            );
            None
        }
        KindName::Prompt => {
            if request.action.is_some() {
                problems.push("`action` is only for entity suggestions".to_owned());
            }
            if request.prompt.is_none() {
                problems.push("a prompt suggestion needs a `prompt`".to_owned());
            }
            match request.run_mode {
                Some(run_mode) => Some(NewKind::Prompt { run_mode }),
                None => {
                    problems.push(
                        "a prompt suggestion needs `runMode`: `composer` or `background`"
                            .to_owned(),
                    );
                    None
                }
            }
        }
        KindName::Entity => {
            if request.prompt.is_some() || request.run_mode.is_some() {
                problems.push("`prompt` and `runMode` are only for prompt suggestions".to_owned());
            }
            if request.about.is_empty() {
                problems
                    .push("an entity suggestion is about at least one item in `about`".to_owned());
            }
            match request.action {
                Some(action) => Some(NewKind::Entity { action }),
                None => {
                    problems.push(
                        "an entity suggestion needs `action`: `reply`, `review` or `follow_up`"
                            .to_owned(),
                    );
                    None
                }
            }
        }
    }
}

/// A dedup key: one short line of lowercase letters, digits and `-_:./`.
pub fn dedup_key(key: &str, problems: &mut Vec<String>) -> Option<String> {
    let key = key.trim();
    let shaped = !key.is_empty()
        && key.chars().count() <= MAX_DEDUP_KEY_CHARS
        && key.chars().all(|c| {
            c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '-' | '_' | ':' | '.' | '/')
        });
    if !shaped {
        problems.push(format!(
            "`dedupKey` is at most {MAX_DEDUP_KEY_CHARS} lowercase letters, digits and -_:./, \
             the same every night for the same suggestion"
        ));
        return None;
    }
    shown(key, "`dedupKey`", problems)
}

/// A title, summary or reason: one plain line of at most `max` characters.
pub fn text(text: &str, field: &str, max: usize, problems: &mut Vec<String>) -> Option<String> {
    match line(text, max) {
        Some(text) => shown(&text, field, problems),
        None => {
            problems.push(format!(
                "{field} must be one plain line of at most {max} characters"
            ));
            None
        }
    }
}

/// A prompt: plain text of at most [`MAX_PROMPT_CHARS`], over several lines
/// if need be.
pub fn prompt(prompt: &str, problems: &mut Vec<String>) -> Option<String> {
    let prompt = prompt.trim();
    let plain = !prompt.is_empty()
        && prompt.chars().count() <= MAX_PROMPT_CHARS
        && !prompt
            .chars()
            .any(|c| (c.is_control() && c != '\n') || is_invisible(c));
    if !plain {
        problems.push(format!(
            "`prompt` is plain text of at most {MAX_PROMPT_CHARS} characters"
        ));
        return None;
    }
    shown(prompt, "`prompt`", problems)
}

/// An importance from 0 to 100.
pub fn importance(importance: u8, problems: &mut Vec<String>) -> Option<u8> {
    if importance > 100 {
        problems.push("`importance` is from 0 to 100".to_owned());
        return None;
    }
    Some(importance)
}

/// Categories, each once.
pub fn categories(categories: Vec<Category>) -> Vec<Category> {
    let mut seen = HashSet::new();
    categories
        .into_iter()
        .filter(|category| seen.insert(*category))
        .collect()
}

/// The items an idea is about: at most [`MAX_TARGETS`], each once, with
/// short plain ids. Whether the person can open them is checked apart.
pub fn targets(targets: Vec<Target>, problems: &mut Vec<String>) -> Option<Vec<Target>> {
    if targets.len() > MAX_TARGETS {
        problems.push(format!("a suggestion is about at most {MAX_TARGETS} items"));
        return None;
    }
    let mut seen = HashSet::new();
    let mut checked = Vec::with_capacity(targets.len());
    for target in targets {
        let id_fits = |id: &str| line(id, MAX_ID_CHARS).is_some_and(|line| line == id);
        if !id_fits(&target.entity_id) || !target.part_id.as_deref().is_none_or(id_fits) {
            problems.push(
                "an item's `entityId` and `partId` are its ids, as the SDK returns them".to_owned(),
            );
            return None;
        }
        if seen.insert(target.clone()) {
            checked.push(target);
        }
    }
    Some(checked)
}

/// `text` when it names no personal detail.
fn shown(text: &str, field: &str, problems: &mut Vec<String>) -> Option<String> {
    match personal_detail(text) {
        Some(detail) => {
            problems.push(format!(
                "{field} names {detail}; point at the item in `about` instead of copying \
                 anyone's details"
            ));
            None
        }
        None => Some(text.to_owned()),
    }
}
