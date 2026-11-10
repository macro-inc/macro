//! What an ideas session of a generation is told.

use chrono::{DateTime, SecondsFormat, Utc};

use super::model::GenerationTrigger;
use super::service::{NEW_PER_GENERATION, OPEN_LIMIT};

/// The task, before the run's details.
const TASK: &str = include_str!("prompt.md");

/// The SDK symbols the session reads in its one documentation call, so it
/// skips browsing entity indexes. Each must name a code-mode SDK symbol.
pub const SYMBOLS: &[&str] = &[
    "IdeaNamespace.review",
    "IdeaNamespace.suggest",
    "IdeaSuggestion",
    "IdeaReview",
    "Idea.rewrite",
    "Idea.retire",
    "UserNamespace.me",
    "MemoryNamespace.read",
    "TeamNamespace.list",
    "InitiativeNamespace.list",
    "NotificationNamespace.list",
    "WorkspaceNamespace.page",
    "EmailNamespace.inbox",
    "EmailThread.messages",
    "SearchNamespace.all",
    "DocumentNamespace.search",
    "Document.content",
    "TaskNamespace.search",
    "CallRecordNamespace.search",
    "CallRecordTranscriptSegment",
    "ChannelNamespace.list",
    "Channel.messages",
    "RoutineNamespace.list",
    "AgentNamespace.list",
    "DatabaseNamespace.list",
];

/// The session's one prompt, for a run started by `trigger`, for a person in
/// IANA zone `timezone`, at `now`.
pub fn brief(trigger: GenerationTrigger, timezone: &str, now: DateTime<Utc>) -> String {
    let occasion = match trigger {
        GenerationTrigger::Onboarding => {
            "The user just signed up: their workspace is nearly empty, so their newest mail \
             and calendar say the most. Be quick; they are waiting."
        }
        GenerationTrigger::Nightly => {
            "This is the nightly run, while the user sleeps: research their whole workspace \
             again, then bring the feed up to date for their morning."
        }
    };
    let task = TASK
        .replace("{occasion}", occasion)
        .replace("{symbols}", &symbols())
        .replace("{open_limit}", &OPEN_LIMIT.to_string())
        .replace("{new_per_generation}", &NEW_PER_GENERATION.to_string());
    let now = now.to_rfc3339_opts(SecondsFormat::Secs, true);
    format!("{task}\nNow is {now}; the user's time zone is {timezone}.")
}

/// [`SYMBOLS`] as the brief names them.
fn symbols() -> String {
    SYMBOLS
        .iter()
        .map(|symbol| format!("`{symbol}`"))
        .collect::<Vec<_>>()
        .join(", ")
}
