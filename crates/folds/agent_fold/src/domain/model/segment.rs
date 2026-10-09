//! How an agent's reply reads as a conversation.
//!
//! A reply is an ordered list of parts: prose, tool calls, requests for the
//! user. A conversation surface - a channel message, a typing row, a live
//! tail under the composer - wants them grouped: a passage the agent wrote,
//! the work it did between passages, and what it is waiting on. This module is
//! that grouping, derived from the parts alone.
//!
//! The same function runs on the server, which posts a reply's sealed
//! segments as channel messages, and in the browser through the wasm fold,
//! which renders the segment still being written. Both read the boundaries
//! from here, so a message the server posted and the live view of the same
//! turn never disagree about where one segment ends.
//!
//! Activity rows carry their own wording. A row is stored in a channel
//! message once its segment is posted, so the label a person reads later is
//! the label the live view showed; wording that differed between the two
//! would make a finished turn look like it changed.
//!
//! A row can also carry a card: what the step produced that a reader wants to
//! see or open rather than read about - the document the agent created, the
//! email it sent, the view it composed for the user. Cards are read from
//! Macro's own tools, whose arguments and results are Macro's whichever
//! harness relayed them, and are stored with the row for the same reason.

use agent_runtime_protocol::domain::tool_approval::ToolApprovalStatus;
use serde::{Deserialize, Serialize};
use specta::Type;

use super::part::MessagePart;
use super::plan::PlanEntryStatus;
use super::tool::{ToolDetail, ToolName, ToolStatus};
use super::user_tool::UserToolOutcome;
use super::{ElicitationOutcome, PermissionOutcome};

#[cfg(test)]
mod test;

/// Longest detail a row keeps, in characters.
const DETAIL_MAX_CHARS: usize = 80;

/// What a segment of a reply is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum SegmentKind {
    /// A passage the agent wrote.
    Prose,
    /// A run of tool calls and plan updates.
    Activity,
    /// A permission or a question the agent put to the user.
    Interaction,
}

/// Where one step of work got to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ActivityStatus {
    /// Started and not finished, including a call waiting on permission.
    Running,
    /// Finished successfully.
    Completed,
    /// Finished unsuccessfully.
    Failed,
    /// Still running when its turn ended: nobody knows whether it finished.
    Interrupted,
}

/// One step of work, worded for a person reading a conversation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ActivityRow {
    /// The tool call's id, stable across updates; `plan` for a plan update.
    pub id: String,
    /// What happened, as a verb phrase: `Ran`, `Reading`, `Search documents`.
    pub label: String,
    /// What it happened to - a command, a file, a query - when that is safe
    /// to show to everyone who can read the conversation.
    pub detail: Option<String>,
    /// Where it got to.
    pub status: ActivityStatus,
    /// What the step produced that a reader may want to see or open, once
    /// it has produced it.
    #[serde(default)]
    pub card: Option<ActivityCard>,
}

/// Something a step produced, shown as a card after the steps of its run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ActivityCard {
    /// A workspace item the step created, changed or sent. Readers load the
    /// item with their own access; the title is what the step knew it as,
    /// for the moment before it loads and for a reader who cannot open it.
    Item {
        /// What kind of item it is.
        #[serde(rename = "itemType")]
        item_type: CardItemType,
        /// The item's id.
        #[serde(rename = "itemId")]
        item_id: String,
        /// A document's file type, when the step named it: `md`,
        /// `spreadsheet`.
        #[serde(rename = "fileType")]
        file_type: Option<String>,
        /// What the step did to it.
        action: CardAction,
        /// The item's name, as the step knew it.
        title: Option<String>,
    },
    /// A view the agent composed for the user: the `DisplayResults` tool's
    /// `view` argument, as the model wrote it. Its widgets name the items
    /// they show, and readers load those with their own access.
    View {
        /// The dynamic-UI view.
        #[specta(type = specta_typescript::Unknown)]
        view: serde_json::Value,
    },
}

/// The kinds of workspace item a card opens.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum CardItemType {
    /// A document, including a spreadsheet.
    Document,
    /// An email thread.
    EmailThread,
    /// A calendar event.
    CalendarEvent,
}

/// What a step did to the item its card opens.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum CardAction {
    /// The step made it: a document, an event.
    Created,
    /// The step changed it.
    Edited,
    /// The step sent it: an email.
    Sent,
}

/// A run of a reply's parts that reads as one unit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    /// Position among the reply's segments, from zero.
    pub index: u32,
    /// What the segment is.
    pub kind: SegmentKind,
    /// Index of the segment's first part.
    pub start: u32,
    /// Index one past the segment's last part.
    pub end: u32,
    /// Whether the segment can still change: false only for the last segment
    /// of a reply that is still being written.
    pub sealed: bool,
    /// The steps, for an activity segment; empty otherwise.
    pub rows: Vec<ActivityRow>,
}

/// What the agent is doing right now, as a typing indicator says it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum TurnPhase {
    /// Nothing to show yet, or between steps.
    Thinking,
    /// Writing prose.
    Writing,
    /// Running a tool.
    Working,
    /// Waiting on the user to answer a permission or a question.
    Waiting,
}

/// A segment with the content a server needs to post it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectedSegment {
    /// The segment's boundaries and rows.
    pub segment: Segment,
    /// The prose, once the segment is sealed. Absent while the agent is
    /// still writing it - an unfinished passage is not posted - and for
    /// every other kind.
    pub text: Option<String>,
}

/// Group a reply's parts into segments.
///
/// `closed` is whether the reply's turn has ended; until it has, the last
/// segment stays open. Thoughts, attachments and controls belong to no
/// segment, and whitespace-only prose is not a passage: a newline the agent
/// emitted between two tool calls must not split their activity in two.
#[must_use]
pub fn segments(parts: &[MessagePart], closed: bool) -> Vec<Segment> {
    let mut out: Vec<Segment> = Vec::new();
    for (index, part) in parts.iter().enumerate() {
        let Some(kind) = part_kind(part) else {
            continue;
        };
        let index = u32::try_from(index).unwrap_or(u32::MAX);
        match out.last_mut() {
            // Each interaction is its own segment: two requests are two
            // things to answer, not one.
            Some(last) if last.kind == kind && kind != SegmentKind::Interaction => {
                last.end = index.saturating_add(1);
            }
            _ => out.push(Segment {
                index: u32::try_from(out.len()).unwrap_or(u32::MAX),
                kind,
                start: index,
                end: index.saturating_add(1),
                sealed: true,
                rows: Vec::new(),
            }),
        }
    }
    if let Some(last) = out.last_mut() {
        last.sealed = closed;
    }
    for segment in &mut out {
        if segment.kind == SegmentKind::Activity {
            segment.rows = activity_rows(slice(parts, segment), closed);
        }
    }
    out
}

/// The segments, with each sealed passage's prose, for a server to post.
#[must_use]
pub fn project(parts: &[MessagePart], closed: bool) -> Vec<ProjectedSegment> {
    segments(parts, closed)
        .into_iter()
        .map(|segment| {
            let text = (segment.kind == SegmentKind::Prose && segment.sealed)
                .then(|| prose_text(parts, &segment));
            ProjectedSegment { segment, text }
        })
        .collect()
}

/// The prose of a segment: its text parts, a blank line apart.
#[must_use]
pub fn prose_text(parts: &[MessagePart], segment: &Segment) -> String {
    slice(parts, segment)
        .iter()
        .filter_map(|part| match part {
            MessagePart::Text { text } if !text.trim().is_empty() => Some(text.trim()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// What an unfinished reply is doing now. `None` once its turn has ended.
///
/// A pending question or approval blocks the turn wherever it sits: the tool
/// that asked can report itself running after its question. Otherwise the
/// phase is read off the last part rather than the last segment: a thought
/// belongs to no segment, and an agent thinking after a passage is not still
/// writing it.
#[must_use]
pub fn phase(parts: &[MessagePart], closed: bool) -> Option<TurnPhase> {
    if closed {
        return None;
    }
    if parts.iter().any(is_pending_request) {
        return Some(TurnPhase::Waiting);
    }
    let phase = match parts.iter().rev().find(|part| !is_blank_text(part)) {
        Some(MessagePart::Text { .. }) => TurnPhase::Writing,
        Some(MessagePart::ToolUse {
            status: ToolStatus::Pending | ToolStatus::Running,
            ..
        }) => TurnPhase::Working,
        _ => TurnPhase::Thinking,
    };
    Some(phase)
}

/// A question or approval the user has not answered yet.
fn is_pending_request(part: &MessagePart) -> bool {
    matches!(
        part,
        MessagePart::Permission {
            outcome: PermissionOutcome::Pending,
            ..
        } | MessagePart::Elicitation {
            outcome: ElicitationOutcome::Pending,
            ..
        } | MessagePart::ToolApproval {
            status: ToolApprovalStatus::Pending,
            ..
        }
    )
}

fn is_blank_text(part: &MessagePart) -> bool {
    matches!(part, MessagePart::Text { text } if text.trim().is_empty())
}

fn part_kind(part: &MessagePart) -> Option<SegmentKind> {
    match part {
        MessagePart::Text { text } if text.trim().is_empty() => None,
        MessagePart::Text { .. } => Some(SegmentKind::Prose),
        MessagePart::ToolUse { .. } | MessagePart::Plan { .. } => Some(SegmentKind::Activity),
        MessagePart::Permission { .. }
        | MessagePart::Elicitation { .. }
        | MessagePart::ToolApproval { .. } => Some(SegmentKind::Interaction),
        MessagePart::Thought { .. }
        | MessagePart::Attachment { .. }
        | MessagePart::Control { .. } => None,
    }
}

fn slice<'a>(parts: &'a [MessagePart], segment: &Segment) -> &'a [MessagePart] {
    let start = (segment.start as usize).min(parts.len());
    let end = (segment.end as usize).clamp(start, parts.len());
    &parts[start..end]
}

fn activity_rows(parts: &[MessagePart], closed: bool) -> Vec<ActivityRow> {
    parts
        .iter()
        .filter_map(|part| match part {
            MessagePart::ToolUse {
                id,
                name,
                status,
                detail,
            } => Some(tool_row(id.0.clone(), name, *status, detail, closed)),
            MessagePart::Plan { entries } => {
                let done = entries
                    .iter()
                    .filter(|entry| entry.status == PlanEntryStatus::Completed)
                    .count();
                Some(ActivityRow {
                    id: "plan".to_owned(),
                    label: "Updated the plan".to_owned(),
                    detail: Some(format!("{done}/{} done", entries.len())),
                    status: ActivityStatus::Completed,
                    card: None,
                })
            }
            _ => None,
        })
        .collect()
}

/// Verb forms for a step: while it runs, once it finished, and if it failed.
struct Verbs {
    running: &'static str,
    done: &'static str,
    failed: &'static str,
}

const RUN: Verbs = Verbs {
    running: "Running",
    done: "Ran",
    failed: "Command failed",
};
const EDIT: Verbs = Verbs {
    running: "Editing",
    done: "Edited",
    failed: "Edit failed",
};
const READ: Verbs = Verbs {
    running: "Reading",
    done: "Read",
    failed: "Read failed",
};
const DELETE: Verbs = Verbs {
    running: "Deleting",
    done: "Deleted",
    failed: "Delete failed",
};
const MOVE: Verbs = Verbs {
    running: "Moving",
    done: "Moved",
    failed: "Move failed",
};
const SEARCH: Verbs = Verbs {
    running: "Searching",
    done: "Searched",
    failed: "Search failed",
};
const FETCH: Verbs = Verbs {
    running: "Fetching",
    done: "Fetched",
    failed: "Fetch failed",
};
const DELEGATE: Verbs = Verbs {
    running: "Delegating",
    done: "Delegated",
    failed: "Delegation failed",
};

fn tool_row(
    id: String,
    name: &ToolName,
    status: ToolStatus,
    detail: &ToolDetail,
    closed: bool,
) -> ActivityRow {
    let status = match status {
        ToolStatus::Pending | ToolStatus::Running if closed => ActivityStatus::Interrupted,
        ToolStatus::Pending | ToolStatus::Running => ActivityStatus::Running,
        ToolStatus::Completed => ActivityStatus::Completed,
        ToolStatus::Failed => ActivityStatus::Failed,
    };
    let card = match detail {
        ToolDetail::Macro { input, output, .. } if status == ActivityStatus::Completed => {
            macro_card(tool_name(name), input, output.as_ref())
        }
        ToolDetail::UserTool { input, outcome } => user_tool_card(tool_name(name), input, outcome),
        _ => None,
    };
    let named = humanize(tool_name(name));
    let verbed = |verbs: &Verbs, detail: Option<String>| {
        let label = match status {
            ActivityStatus::Running => verbs.running,
            ActivityStatus::Completed | ActivityStatus::Interrupted => verbs.done,
            ActivityStatus::Failed => verbs.failed,
        };
        (label.to_owned(), detail)
    };
    let (label, detail) = match detail {
        ToolDetail::Terminal { command, .. } => {
            verbed(&RUN, command.as_deref().map(command_detail))
        }
        ToolDetail::Edit { diffs } => verbed(
            &EDIT,
            paths_detail(diffs.iter().map(|diff| diff.path.as_path())),
        ),
        ToolDetail::Read { paths } => {
            verbed(&READ, paths_detail(paths.iter().map(|p| p.as_path())))
        }
        ToolDetail::Delete { paths } => {
            verbed(&DELETE, paths_detail(paths.iter().map(|p| p.as_path())))
        }
        ToolDetail::Move { paths } => {
            verbed(&MOVE, paths_detail(paths.iter().map(|p| p.as_path())))
        }
        ToolDetail::Search { paths, .. } => {
            verbed(&SEARCH, paths_detail(paths.iter().map(|p| p.as_path())))
        }
        ToolDetail::Fetch { .. } => verbed(&FETCH, None),
        ToolDetail::Think { .. } => ("Thought it through".to_owned(), None),
        ToolDetail::Other { input, .. } => (
            named_label(&named, status),
            input.as_ref().and_then(input_detail),
        ),
        ToolDetail::Macro { input, .. } => (named_label(&named, status), input_detail(input)),
        ToolDetail::UserTool { outcome, .. } => (user_tool_label(&named, outcome), None),
        ToolDetail::Subagent { title, .. } => verbed(&DELEGATE, Some(truncate(title))),
    };
    ActivityRow {
        id,
        label,
        detail,
        status,
        card,
    }
}

/// The card a finished Macro tool call earns, by the tool's own arguments
/// and result.
fn macro_card(
    tool: &str,
    input: &serde_json::Value,
    output: Option<&serde_json::Value>,
) -> Option<ActivityCard> {
    let field = |value: Option<&serde_json::Value>, key: &str| {
        value
            .and_then(|value| value.get(key))
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(str::to_owned)
    };
    let document = |id, file_type: Option<&str>, action, title| ActivityCard::Item {
        item_type: CardItemType::Document,
        item_id: id,
        file_type: file_type.map(str::to_owned),
        action,
        title,
    };
    match tool {
        "DisplayResults" => input
            .get("view")
            .map(|view| ActivityCard::View { view: view.clone() }),
        "CreateDocument" => Some(document(
            field(output, "documentId")?,
            field(Some(input), "fileExtension").as_deref(),
            CardAction::Created,
            field(Some(input), "documentName"),
        )),
        "EditDocument" => Some(document(
            field(Some(input), "documentId")?,
            Some("md"),
            CardAction::Edited,
            None,
        )),
        "EditSpreadsheet" => Some(document(
            field(Some(input), "documentId")?,
            Some("spreadsheet"),
            CardAction::Edited,
            None,
        )),
        "CreateConfirmedCalendarEvent" => event_card(output?, CardAction::Created),
        "UpdateCalendarEvent" => event_card(output?, CardAction::Edited),
        _ => None,
    }
}

/// The card a user tool earns once the user has finished what the agent
/// drafted: the email they sent, the event they created.
fn user_tool_card(
    tool: &str,
    input: &serde_json::Value,
    outcome: &UserToolOutcome,
) -> Option<ActivityCard> {
    match outcome {
        UserToolOutcome::Sent { thread_id, .. } if tool == "SendEmail" => {
            Some(ActivityCard::Item {
                item_type: CardItemType::EmailThread,
                item_id: thread_id.clone(),
                file_type: None,
                action: CardAction::Sent,
                title: input
                    .get("subject")
                    .and_then(serde_json::Value::as_str)
                    .map(str::trim)
                    .filter(|subject| !subject.is_empty())
                    .map(str::to_owned),
            })
        }
        UserToolOutcome::Completed { result } if tool == "CreateCalendarEvent" => {
            event_card(result, CardAction::Created)
        }
        _ => None,
    }
}

/// A calendar event's card, from the event a calendar tool returned.
fn event_card(event: &serde_json::Value, action: CardAction) -> Option<ActivityCard> {
    let text = |key: &str| {
        event
            .get(key)
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(str::to_owned)
    };
    Some(ActivityCard::Item {
        item_type: CardItemType::CalendarEvent,
        item_id: text("eventId")?,
        file_type: None,
        action,
        title: text("title"),
    })
}

/// A tool known only by name reads as its name in every state; the status
/// icon says whether it is running.
fn named_label(named: &str, status: ActivityStatus) -> String {
    match status {
        ActivityStatus::Failed => format!("{named} failed"),
        ActivityStatus::Running | ActivityStatus::Completed | ActivityStatus::Interrupted => {
            named.to_owned()
        }
    }
}

fn user_tool_label(named: &str, outcome: &UserToolOutcome) -> String {
    let state = match outcome {
        UserToolOutcome::Pending | UserToolOutcome::Edited => "drafted",
        UserToolOutcome::Sent { .. } => "sent",
        UserToolOutcome::Draft { .. } => "saved as draft",
        UserToolOutcome::Completed { .. } => "done",
        UserToolOutcome::Rejected => "declined",
        UserToolOutcome::Failed { .. } => "failed",
        UserToolOutcome::Unrecognized => "finished",
    };
    format!("{named} {state}")
}

fn tool_name(name: &ToolName) -> &str {
    match name {
        ToolName::Native { name } => name,
        ToolName::Mcp { tool, .. } => tool,
    }
}

/// `ListEntities`, `list_entities` and `list-entities` all read `List entities`.
fn humanize(name: &str) -> String {
    let mut words: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut previous: Option<char> = None;
    for character in name.chars() {
        if matches!(character, '_' | '-' | ' ' | '.') {
            if !current.is_empty() {
                words.push(std::mem::take(&mut current));
            }
        } else {
            let boundary = character.is_uppercase()
                && previous
                    .is_some_and(|previous| previous.is_lowercase() || previous.is_numeric());
            if boundary && !current.is_empty() {
                words.push(std::mem::take(&mut current));
            }
            current.push(character);
        }
        previous = Some(character);
    }
    if !current.is_empty() {
        words.push(current);
    }
    let sentence = words
        .iter()
        .map(|word| {
            // Keep acronyms (`URL`, `PDF`) as written.
            if word.len() > 1 && word.chars().all(|c| c.is_uppercase() || c.is_numeric()) {
                word.clone()
            } else {
                word.to_lowercase()
            }
        })
        .collect::<Vec<_>>()
        .join(" ");
    let mut characters = sentence.chars();
    match characters.next() {
        Some(first) => first.to_uppercase().chain(characters).collect(),
        None => "Tool".to_owned(),
    }
}

fn truncate(text: &str) -> String {
    let line = text.lines().next().unwrap_or_default().trim();
    if line.chars().count() <= DETAIL_MAX_CHARS {
        return line.to_owned();
    }
    let kept: String = line.chars().take(DETAIL_MAX_CHARS - 1).collect();
    format!("{}…", kept.trim_end())
}

/// A command's first line, cut to length.
fn command_detail(command: &str) -> String {
    truncate(command.lines().next().unwrap_or_default())
}

/// A file's name, or how many files.
fn paths_detail<'a>(paths: impl Iterator<Item = &'a std::path::Path>) -> Option<String> {
    let paths: Vec<_> = paths.collect();
    match paths.as_slice() {
        [] => None,
        [path] => Some(truncate(
            &path
                .file_name()
                .map_or_else(|| path.to_string_lossy(), |name| name.to_string_lossy()),
        )),
        many => Some(format!("{} files", many.len())),
    }
}

/// The argument that says what a tool acted on, for tools known by name: a
/// query, a title, a name - of a document or file too - a URL. Only short
/// plain strings qualify.
fn input_detail(input: &serde_json::Value) -> Option<String> {
    const KEYS: [&str; 9] = [
        "query",
        "q",
        "title",
        "name",
        "documentName",
        "fileName",
        "url",
        "path",
        "subject",
    ];
    let object = input.as_object()?;
    KEYS.iter().find_map(|key| {
        object
            .get(*key)
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(truncate)
    })
}
