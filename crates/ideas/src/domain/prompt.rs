//! What an ideas session of a generation is told.

use chrono::{DateTime, SecondsFormat, Utc};

use super::model::GenerationTrigger;
use super::service::{NEW_PER_GENERATION, OPEN_LIMIT};

#[cfg(test)]
mod test;

/// The task, before the run's details.
const TASK: &str = include_str!("prompt.md");

/// The SDK methods every session uses, given to it as a compact reference
/// (or, without one, read in a single documentation call). Each must name a
/// code-mode SDK symbol.
pub const SYMBOLS: &[&str] = &[
    "SuggestionNamespace.review",
    "SuggestionNamespace.suggest",
    "Suggestion.rewrite",
    "Suggestion.retire",
    "UserNamespace.me",
    "MemoryNamespace.read",
    "TeamNamespace.list",
    "InitiativeNamespace.list",
    "NotificationNamespace.list",
    "WorkspaceNamespace.list",
    "TaskNamespace.summaries",
    "DocumentNamespace.byId",
    "CallRecordNamespace.byId",
    "EmailNamespace.byId",
    "ChannelNamespace.byId",
    "EmailNamespace.inbox",
    "EmailNamespace.search",
    "EmailThread.messages",
    "SearchNamespace.all",
    "DocumentNamespace.search",
    "Document.content",
    "TaskNamespace.search",
    "CallRecordNamespace.search",
    "ChannelNamespace.list",
    "Channel.messages",
    "RoutineNamespace.list",
    "AgentNamespace.list",
    "DatabaseNamespace.list",
    "AiNamespace.structuredCompletion",
];

/// The handles whose fields the reference lists.
pub const FIELDS_OF: &[&str] = &[
    "EmailThread",
    "EmailMessage",
    "Document",
    "Task",
    "CallRecord",
    "Channel",
    "Message",
    "Notification",
    "Initiative",
];

/// The session's one prompt, for a run started by `trigger`, for a person in
/// IANA zone `timezone`, at `now`, with `reference`, the SDK reference for
/// [`SYMBOLS`] and [`FIELDS_OF`] (empty when there is none), and `checker`,
/// the model that reads each new idea against its items.
pub fn brief(
    trigger: GenerationTrigger,
    timezone: &str,
    now: DateTime<Utc>,
    reference: &str,
    checker: &str,
) -> String {
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
        .replace("{docs}", &docs(reference))
        .replace("{open_limit}", &OPEN_LIMIT.to_string())
        .replace("{new_per_generation}", &NEW_PER_GENERATION.to_string())
        .replace("{checker_model}", checker);
    let task = format!("{task}\n{}", clock(timezone, now));
    if reference.is_empty() {
        task
    } else {
        format!("{task}\n\n## SDK reference\n\n{reference}")
    }
}

/// What time it is for the person: the weekday and their local time when
/// `timezone` is a zone we know, so "today" and "tomorrow" need no arithmetic.
fn clock(timezone: &str, now: DateTime<Utc>) -> String {
    let utc = now.to_rfc3339_opts(SecondsFormat::Secs, true);
    match timezone.parse::<chrono_tz::Tz>() {
        Ok(zone) => format!(
            "Now is {} for the user ({timezone}), {utc}.",
            now.with_timezone(&zone).format("%A %Y-%m-%d %H:%M")
        ),
        Err(_) => format!("Now is {utc}; the user's time zone is {timezone}."),
    }
}

/// How the session learns the SDK: from the reference at the end of the
/// brief, or else from one documentation call for [`SYMBOLS`].
fn docs(reference: &str) -> String {
    if reference.is_empty() {
        format!("Start with one ReadCodeDocs call for {}", symbols())
    } else {
        "The SDK reference at the end lists the methods and fields you need, and this brief \
         spells out the suggestions methods; fields that load from the server are functions to \
         await (`await message.body()`). Read a symbol with ReadCodeDocs only when you need a \
         type neither names, all such symbols in one call"
            .to_owned()
    }
}

/// [`SYMBOLS`] as the brief names them.
fn symbols() -> String {
    SYMBOLS
        .iter()
        .map(|symbol| format!("`{symbol}`"))
        .collect::<Vec<_>>()
        .join(", ")
}
