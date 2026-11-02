//! Conservative native control decisions, independent of terminal I/O.

use super::acp_agent::TuiAgent;

#[cfg(test)]
mod test;

/// Only dialogs with an explicit, known affirmative shortcut can be answered
/// remotely. Other questions remain interactive in the native TUI.
pub(crate) fn approve_key(kind: TuiAgent, screen: &str) -> Option<&'static str> {
    match kind {
        TuiAgent::Codex
            if screen.contains("Would you like to") && screen.contains("1. Yes, proceed (y)") =>
        {
            Some("y")
        }
        TuiAgent::Claude
            if screen.contains("Do you want to proceed?") && screen.contains("1. Yes") =>
        {
            Some("1")
        }
        _ => None,
    }
}

/// Claude Code's exit confirmation, shown when Ctrl-C is pressed again while
/// background work runs. Its Esc answer is "Stay", which keeps the session.
pub(crate) fn exit_confirmation(kind: TuiAgent, screen: &str) -> bool {
    kind == TuiAgent::Claude
        && screen.contains("Exit and stop tasks")
        && screen.contains("Stay")
        && screen.contains("Esc to cancel")
}

/// A dialog's own "don't ask again" answer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct NativeAlways {
    /// The key that picks it.
    pub key: String,
    /// The dialog's wording, which says what it will remember.
    pub name: String,
}

/// The dialog's own "don't ask again" answer, when it shows one with a known
/// shortcut: Codex labels each answer `(key)`, Claude Code takes its number.
pub(crate) fn always_choice(kind: TuiAgent, screen: &str) -> Option<NativeAlways> {
    screen.lines().find_map(|line| {
        let (_, number, name, shortcut) = lazy_regex::regex_captures!(
            r"^\s*[›❯>]?\s*(\d+)\. (Yes, (?:and don't ask again|allow all).*?)(?: \(([^()]+)\))?\s*$",
            line
        )?;
        let key = match kind {
            TuiAgent::Codex if shortcut.chars().count() == 1 => shortcut,
            TuiAgent::Codex => return None,
            TuiAgent::Claude => number,
        };
        Some(NativeAlways {
            key: key.to_owned(),
            name: name.to_owned(),
        })
    })
}

/// A reply may affect only the same visible dialog and native state generation.
pub(crate) fn same_dialog(
    before: &str,
    after: &str,
    expected_seq: u64,
    actual_seq: u64,
    status: &str,
) -> bool {
    status == "blocked" && expected_seq == actual_seq && before == after
}
