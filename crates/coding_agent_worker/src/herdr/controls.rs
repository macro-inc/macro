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
