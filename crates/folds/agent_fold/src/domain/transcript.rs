//! Pure native-transcript normalization. File framing and session ownership
//! belong to the caller; each fold consumes complete JSON records in order.
use serde_json::Value;

/// Normalize one native transcript record into ACP updates and turn facts.
/// Unknown records produce no events. Keep one instance per native session.
pub trait Fold {
    /// Consume one complete JSONL record, retaining provider deduplication state.
    fn entry(&mut self, line: &str) -> Vec<LogEvent>;
}

/// Longest tool output forwarded to Macro, in characters.
const TOOL_OUTPUT_LIMIT: usize = 4_000;

/// What one transcript line means for the ACP session.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub enum LogEvent {
    /// A `session/update` payload to send.
    Update(Value),
    /// The turn is over, with this ACP stop reason.
    TurnEnded(&'static str),
}

/// Bound tool output without splitting UTF-8 characters.
pub fn truncate(text: &str) -> String {
    if text.chars().count() <= TOOL_OUTPUT_LIMIT {
        return text.to_owned();
    }
    let mut kept: String = text.chars().take(TOOL_OUTPUT_LIMIT).collect();
    kept.push_str("\n… [truncated]");
    kept
}
