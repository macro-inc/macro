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
//!
//! Everyone who can read the conversation reads a stored card, including
//! readers who cannot open the item it names. So a card names the item and
//! says what was done to it - how many changes, who an email went to, where
//! an item moved - and never quotes what the item says: not the text an edit
//! was asked to write, a comment's anchor, or a post's words. Readers who can
//! open the item load the rest with their own access.

use agent_runtime_protocol::domain::tool_approval::ToolApprovalStatus;
use serde::{Deserialize, Serialize};
use specta::Type;

use super::part::MessagePart;
use super::plan::PlanEntryStatus;
use super::tool::{ToolDetail, ToolName, ToolStatus};
use super::user_tool::UserToolOutcome;
use super::{AnsweredValue, ElicitationOutcome, ElicitationRequest, PermissionOutcome};

#[cfg(test)]
mod test;

mod code_execution;

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
    /// What the step produced, once it has produced it: the item it
    /// created, changed or sent, or what the agent chose to show with it.
    #[serde(default)]
    pub card: Option<ActivityCard>,
}

/// Something a step produced. What the agent chose to show - a view, a
/// database answer, drafts to review - is shown where the step ran. An item
/// the step created, changed or sent is not shown on its own: the step's
/// row names it, and a view that shows the item says what was done to it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ActivityCard {
    /// A workspace item the step created, changed or sent. Readers load the
    /// item with their own access; the title is what the step knew it as,
    /// for the moment before it loads and for a reader who cannot open it.
    /// The step's row names it, and a card for it in a view of the same
    /// reply says what was done to it.
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
        /// What happened to it, in a few words that never quote the item:
        /// `3 changes`, `to Ana Ruiz`.
        summary: Option<String>,
    },
    /// A view the agent composed for the user: the `Show` tool's `view`
    /// argument, or the view a code run returned, as the model wrote it. Its widgets name the items they show, and readers load those with
    /// their own access.
    View {
        /// The dynamic-UI view.
        #[specta(type = specta_typescript::Unknown)]
        view: serde_json::Value,
    },
    /// A database answer the agent asked to show. Only the statement is
    /// stored: readers run it again with their own access, so the numbers
    /// are current and a reader never sees rows they could not query.
    Data {
        /// The `SELECT` statement, as the agent ran it.
        sql: String,
        /// The database it is scoped to, when the agent named one.
        #[serde(rename = "databaseId")]
        database_id: Option<String>,
        /// How the agent asked to show it: `table`, `bar`, `line`.
        display: Option<String>,
    },
    /// Drafts the agent saved for the user to edit and send: a saved review
    /// it presented. Only the review's id and what its drafts are is
    /// stored. A reader loads the drafts with their own access to the
    /// session, and only the person the agent works for decides them.
    Review {
        /// The saved review.
        #[serde(rename = "reviewId")]
        review_id: String,
        /// What its drafts are.
        drafts: ReviewDrafts,
    },
}

/// What a saved review's drafts are.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ReviewDrafts {
    /// Emails to send.
    Email,
    /// Calendar events to create.
    Calendar,
}

/// The kinds of workspace item a card opens.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum CardItemType {
    /// A document, including a spreadsheet, a presentation or an uploaded file.
    Document,
    /// An email thread.
    EmailThread,
    /// A calendar event.
    CalendarEvent,
    /// A project folder.
    Project,
    /// A channel.
    Channel,
    /// A routine: a job run on a schedule.
    Routine,
    /// A form.
    Form,
    /// An initiative.
    Initiative,
}

/// What a step did to the item its card opens.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum CardAction {
    /// The step made it: a document, an event.
    Created,
    /// The step changed its content.
    Edited,
    /// The step sent it: an email, a channel message.
    Sent,
    /// The step changed its settings or properties.
    Updated,
    /// The step moved it somewhere else.
    Moved,
    /// The step shared it with someone.
    Shared,
    /// The step renamed it.
    Renamed,
    /// The step commented on it.
    Commented,
    /// The step deleted or canceled it.
    Deleted,
    /// The step tried to change it and failed.
    Failed,
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

/// Which segment a part belongs to, if any.
///
/// A request still waiting on the user is a segment of its own, answered
/// live. Once answered it is history and splits nothing: a question that
/// stood in for its tool call - a user tool's review, a harness's own
/// question tool - is that call's step, and any other request is told by
/// the row of the tool it was about.
fn part_kind(part: &MessagePart) -> Option<SegmentKind> {
    match part {
        MessagePart::Text { text } if text.trim().is_empty() => None,
        _ if is_turned_back_view(part) => None,
        MessagePart::Text { .. } => Some(SegmentKind::Prose),
        MessagePart::ToolUse { .. } | MessagePart::Plan { .. } => Some(SegmentKind::Activity),
        _ if is_pending_request(part) => Some(SegmentKind::Interaction),
        MessagePart::Elicitation {
            tool_call: Some(_), ..
        } => Some(SegmentKind::Activity),
        MessagePart::Permission { .. }
        | MessagePart::Elicitation { .. }
        | MessagePart::ToolApproval { .. }
        | MessagePart::Thought { .. }
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
        .flat_map(|part| match part {
            _ if is_turned_back_view(part) => Vec::new(),
            MessagePart::ToolUse {
                id,
                name,
                status,
                detail,
            } => code_execution::rows(&id.0, name, detail, closed)
                .unwrap_or_else(|| vec![tool_row(id.0.clone(), name, *status, detail, closed)]),
            MessagePart::Elicitation {
                tool_call: Some(id),
                message,
                request,
                outcome,
                tool_outcome,
                ..
            } => vec![answered_row(
                id.0.clone(),
                message,
                request,
                outcome,
                tool_outcome.as_ref(),
                closed,
            )],
            MessagePart::Plan { entries } => {
                let done = entries
                    .iter()
                    .filter(|entry| entry.status == PlanEntryStatus::Completed)
                    .count();
                vec![ActivityRow {
                    id: "plan".to_owned(),
                    label: "Updated the plan".to_owned(),
                    detail: Some(format!("{done}/{} done", entries.len())),
                    status: ActivityStatus::Completed,
                    card: None,
                }]
            }
            _ => Vec::new(),
        })
        .collect()
}

/// The step an answered question stands for, when it stood in for a tool
/// call: the user tool it reviewed - the email as the user sent it, the
/// event created, with its card - or the question itself. A question's
/// answer is not told: only that it was answered.
fn answered_row(
    id: String,
    message: &str,
    request: &ElicitationRequest,
    outcome: &ElicitationOutcome,
    tool_outcome: Option<&UserToolOutcome>,
    closed: bool,
) -> ActivityRow {
    let row = |label: &str, detail: Option<String>, status, card| ActivityRow {
        id: id.clone(),
        label: label.to_owned(),
        detail,
        status,
        card,
    };
    let ElicitationRequest::UserTool { tool, draft, .. } = request else {
        let detail = prose_line(message);
        return match outcome {
            ElicitationOutcome::Pending | ElicitationOutcome::Accepted { .. } => {
                row("Answered", detail, ActivityStatus::Completed, None)
            }
            ElicitationOutcome::Completed => row("Opened", detail, ActivityStatus::Completed, None),
            ElicitationOutcome::Declined => row("Skipped", detail, ActivityStatus::Completed, None),
            ElicitationOutcome::Cancelled => {
                row("Question canceled", detail, ActivityStatus::Completed, None)
            }
            ElicitationOutcome::Errored { .. } | ElicitationOutcome::Unrecognized => {
                row("Question failed", detail, ActivityStatus::Failed, None)
            }
        };
    };
    let words = UserToolWords::of(tool);
    // What went out is what the user accepted: the draft as they edited it,
    // when their composer sent it whole, else the agent's draft as it was.
    let edited = accepted_draft(outcome);
    let draft: &serde_json::Value = edited.as_ref().unwrap_or(draft);
    let detail = text(Some(draft), words.title_field);
    match outcome {
        ElicitationOutcome::Declined | ElicitationOutcome::Cancelled => {
            return row(words.discarded, detail, ActivityStatus::Completed, None);
        }
        ElicitationOutcome::Errored { .. } | ElicitationOutcome::Unrecognized => {
            return row(words.failed, detail, ActivityStatus::Failed, None);
        }
        ElicitationOutcome::Pending
        | ElicitationOutcome::Accepted { .. }
        | ElicitationOutcome::Completed => {}
    }
    match tool_outcome {
        None | Some(UserToolOutcome::Pending | UserToolOutcome::Edited) => {
            let status = if closed {
                ActivityStatus::Interrupted
            } else {
                ActivityStatus::Running
            };
            row(words.running, detail, status, None)
        }
        Some(UserToolOutcome::Draft { .. }) => {
            row(words.saved, detail, ActivityStatus::Completed, None)
        }
        Some(UserToolOutcome::Rejected) => {
            row(words.discarded, detail, ActivityStatus::Completed, None)
        }
        Some(UserToolOutcome::Failed { .. }) => {
            row(words.failed, detail, ActivityStatus::Failed, None)
        }
        Some(
            done @ (UserToolOutcome::Sent { .. }
            | UserToolOutcome::Completed { .. }
            | UserToolOutcome::Unrecognized),
        ) => row(
            words.done,
            detail,
            ActivityStatus::Completed,
            user_tool_card(tool, draft, done),
        ),
    }
}

/// The answer field a client with a user tool's own composer sends the
/// whole edited draft under. Mirrors `ai_tools::user_tool_review::DRAFT_FIELD`;
/// restated here so the wasm fold does not depend on the toolset crate.
const DRAFT_FIELD: &str = "draft";

/// The whole draft a review was accepted with, read the way the agent's
/// finisher reads it (`ai_tools::user_tool_review::apply_review`): the JSON
/// text of an object, or the object itself. Nothing when the review was not
/// accepted, or its answer carried no whole draft.
fn accepted_draft(outcome: &ElicitationOutcome) -> Option<serde_json::Value> {
    let ElicitationOutcome::Accepted { answers } = outcome else {
        return None;
    };
    let answer = answers.iter().find(|answer| answer.name == DRAFT_FIELD)?;
    let draft = match &answer.value {
        AnsweredValue::Text { text } => serde_json::from_str(text).ok()?,
        AnsweredValue::Unrecognized { raw } => raw.clone(),
        _ => return None,
    };
    draft.is_object().then_some(draft)
}

/// How a user tool's step reads at each point of its review.
struct UserToolWords {
    drafted: &'static str,
    running: &'static str,
    done: &'static str,
    saved: &'static str,
    discarded: &'static str,
    failed: &'static str,
    /// The draft's field that names it: an email's subject.
    title_field: &'static str,
}

impl UserToolWords {
    fn of(tool: &str) -> Self {
        match tool {
            "SendEmail" => Self {
                drafted: "Drafted email",
                running: "Sending email",
                done: "Sent email",
                saved: "Saved email draft",
                discarded: "Discarded email draft",
                failed: "Email not sent",
                title_field: "subject",
            },
            "CreateCalendarEvent" => Self {
                drafted: "Drafted event",
                running: "Creating event",
                done: "Created event",
                saved: "Saved event draft",
                discarded: "Discarded event draft",
                failed: "Event not created",
                title_field: "title",
            },
            _ => Self {
                drafted: "Drafted for you",
                running: "Finishing your draft",
                done: "Finished your draft",
                saved: "Saved your draft",
                discarded: "Discarded your draft",
                failed: "Draft failed",
                title_field: "title",
            },
        }
    }
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
const SHOW: Verbs = Verbs {
    running: "Showing",
    done: "Showed",
    failed: "Show failed",
};
const PRESENT_REVIEW: Verbs = Verbs {
    running: "Preparing drafts to review",
    done: "Prepared drafts to review",
    failed: "Couldn't prepare drafts to review",
};

/// Whether a call is to the tool the agent shows the user a view with,
/// which replies saved before its rename call `DisplayResults`.
fn is_show(name: &ToolName, detail: &ToolDetail) -> bool {
    matches!(detail, ToolDetail::Macro { .. })
        && matches!(tool_name(name), "Show" | "DisplayResults")
}

/// A view the renderer would not draw, turned back to the agent with what to
/// fix. It showed nothing, so it is no step: the agent shows the view again,
/// or answers without one.
fn is_turned_back_view(part: &MessagePart) -> bool {
    matches!(
        part,
        MessagePart::ToolUse {
            name,
            status: ToolStatus::Failed,
            detail,
            ..
        } if is_show(name, detail)
    )
}

/// Macro's internal server: the tools it serves every session itself.
const MACRO_INTERNAL: &str = "macro_internal";

/// Whether a call is to the tool that saves drafts for the user to review.
fn is_present_review(name: &ToolName) -> bool {
    matches!(name, ToolName::Mcp { server, tool } if server == MACRO_INTERNAL && tool == "PresentReview")
}

/// The card for a saved review: the presentation Macro writes into the
/// session for it, whose id names the review. An agent's own call to the
/// tool only asks for one, and earns none, so a review is one card however
/// it came to be presented.
fn presented_review_card(
    id: &str,
    name: &ToolName,
    input: Option<&serde_json::Value>,
) -> Option<ActivityCard> {
    if !is_present_review(name) {
        return None;
    }
    let review_id = text(input, "reviewId")?;
    macro_uuid::Uuid::try_parse(&review_id).ok()?;
    if id.strip_prefix("review_") != Some(review_id.as_str()) {
        return None;
    }
    let drafts = match text(input, "kind")?.as_str() {
        "email" => ReviewDrafts::Email,
        "calendar" => ReviewDrafts::Calendar,
        _ => return None,
    };
    Some(ActivityCard::Review { review_id, drafts })
}

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
        ToolDetail::Other { input, .. } if status == ActivityStatus::Completed => {
            presented_review_card(&id, name, input.as_ref())
        }
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
        ToolDetail::Other { input, .. } if is_present_review(name) => {
            verbed(&PRESENT_REVIEW, input.as_ref().and_then(input_detail))
        }
        ToolDetail::Other { input, .. } => (
            named_label(&named, status),
            input.as_ref().and_then(input_detail),
        ),
        ToolDetail::Macro { input, .. } if is_show(name, detail) => verbed(
            &SHOW,
            input.get("view").and_then(|view| text(Some(view), "title")),
        ),
        ToolDetail::Macro { input, .. } => (named_label(&named, status), input_detail(input)),
        ToolDetail::UserTool { input, outcome } => {
            let words = UserToolWords::of(tool_name(name));
            (
                user_tool_label(&words, outcome).to_owned(),
                text(Some(input), words.title_field),
            )
        }
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

/// A string field of a tool's arguments or result, trimmed, when present.
fn text(value: Option<&serde_json::Value>, key: &str) -> Option<String> {
    value
        .and_then(|value| value.get(key))
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_owned)
}

/// What an item card knows besides the item and what happened to it.
#[derive(Default)]
struct ItemFacts {
    file_type: Option<String>,
    title: Option<String>,
    summary: Option<String>,
}

fn item_card(
    item_type: CardItemType,
    item_id: String,
    action: CardAction,
    facts: ItemFacts,
) -> ActivityCard {
    ActivityCard::Item {
        item_type,
        item_id,
        file_type: facts.file_type,
        action,
        title: facts.title,
        summary: facts.summary,
    }
}

/// One line of prose for a row's detail, from markdown that may hold
/// markup: the first line that says anything, with tags, emphasis, link
/// targets and block markers dropped, whitespace collapsed, cut to a
/// readable length.
fn prose_line(raw: &str) -> Option<String> {
    let plain = lazy_regex::regex_replace_all!(r"<[^>]*>", raw, "");
    let line = plain
        .lines()
        .map(|line| lazy_regex::regex_replace!(r"^\s*(?:#{1,6}|>|[-*+]|\d+\.)\s+", line, ""))
        .map(|line| {
            lazy_regex::regex_replace_all!(r"\[([^\]]*)\]\([^)]*\)", &line, "$1").into_owned()
        })
        .map(|line| lazy_regex::regex_replace_all!(r"\*\*|__|[*`~]", &line, "").into_owned())
        .map(|line| line.split_whitespace().collect::<Vec<_>>().join(" "))
        .find(|line| !line.is_empty())?;
    if line.chars().count() <= DETAIL_MAX_CHARS {
        return Some(line);
    }
    let cut: String = line.chars().take(DETAIL_MAX_CHARS - 1).collect();
    Some(format!("{}…", cut.trim_end()))
}

/// Who an email went to: `to Ana Ruiz`, `to Ana Ruiz and 2 others`.
/// A recipient is an address, or an address with a name.
fn recipients(input: &serde_json::Value) -> Option<String> {
    let to = input.get("to")?.as_array()?;
    let first = to.first()?;
    let name = match first.as_str() {
        Some(address) => Some(address.trim().to_owned()).filter(|address| !address.is_empty()),
        None => text(Some(first), "name").or_else(|| text(Some(first), "email")),
    }?;
    Some(match to.len() {
        1 => format!("to {name}"),
        2 => format!("to {name} and 1 other"),
        count => format!("to {name} and {} others", count - 1),
    })
}

/// How many changes an edit made, when it made several. A change's own
/// words quote the item - a spreadsheet's describe the cells - so only the
/// count is kept.
fn changes_summary(changes: Option<&serde_json::Value>) -> Option<String> {
    let count = changes?.as_array()?.len();
    (count > 1).then(|| format!("{count} changes"))
}

/// What a form change that did not finish left behind, worded for its item card.
fn form_state(output: Option<&serde_json::Value>) -> Option<String> {
    match text(output, "state").as_deref() {
        Some("partiallyApplied") => Some("Partly saved".to_owned()),
        Some("savedPendingProjection") => Some("Saved, still updating".to_owned()),
        _ => None,
    }
}

/// The file type an uploaded file's name gives it.
fn extension(name: &str) -> Option<String> {
    let (_, extension) = name.rsplit_once('.')?;
    (!extension.is_empty()).then(|| extension.to_ascii_lowercase())
}

/// The card type a tool's entity type names, for the kinds a card shows.
fn entity_card_type(entity_type: &str) -> Option<CardItemType> {
    match entity_type {
        "document" => Some(CardItemType::Document),
        "email" | "email_thread" | "thread" => Some(CardItemType::EmailThread),
        "project" => Some(CardItemType::Project),
        "channel" => Some(CardItemType::Channel),
        "initiative" => Some(CardItemType::Initiative),
        _ => None,
    }
}

/// Whether a result says the change did not happen.
fn refused(output: Option<&serde_json::Value>, key: &str) -> bool {
    output
        .and_then(|output| output.get(key))
        .and_then(serde_json::Value::as_bool)
        == Some(false)
}

/// The card a finished Macro tool call earns, by the tool's own arguments
/// and result: the item it made or changed, or the view it composed.
fn macro_card(
    tool: &str,
    input: &serde_json::Value,
    output: Option<&serde_json::Value>,
) -> Option<ActivityCard> {
    use CardAction::{Commented, Created, Deleted, Edited, Moved, Renamed, Sent, Updated};
    use CardItemType::{
        CalendarEvent, Channel, Document, EmailThread, Form, Initiative, Project, Routine,
    };
    let arg = |key: &str| text(Some(input), key);
    let result = |key: &str| text(output, key);
    match tool {
        "Show" | "DisplayResults" => input
            .get("view")
            .map(|view| ActivityCard::View { view: view.clone() }),
        "CreateDocument" => Some(item_card(
            Document,
            result("documentId")?,
            Created,
            ItemFacts {
                file_type: arg("fileExtension"),
                title: arg("documentName"),
                ..ItemFacts::default()
            },
        )),
        // EditDocument's arguments keep their Rust names. An edit that asked
        // for clarification instead changed nothing. Its instructions are
        // the text it was asked to write, so they stay out of the item card.
        "EditDocument" => output
            .and_then(|output| output.get("clarification"))
            .is_none_or(serde_json::Value::is_null)
            .then(|| {
                Some(item_card(
                    Document,
                    arg("document_id")?,
                    Edited,
                    ItemFacts {
                        file_type: Some("md".to_owned()),
                        ..ItemFacts::default()
                    },
                ))
            })
            .flatten(),
        // An edit the sheet did not apply changed nothing.
        "EditSpreadsheet" if !refused(output, "applied") => Some(item_card(
            Document,
            arg("documentId")?,
            Edited,
            ItemFacts {
                file_type: Some("spreadsheet".to_owned()),
                summary: changes_summary(output.and_then(|output| output.get("changes"))),
                ..ItemFacts::default()
            },
        )),
        "EditWordDocument" => Some(item_card(
            Document,
            arg("documentId")?,
            Edited,
            ItemFacts {
                file_type: Some("docx".to_owned()),
                summary: changes_summary(input.get("operations")),
                ..ItemFacts::default()
            },
        )),
        // Saving a presentation as a copy makes a new one under that name.
        "EditPresentation" => match input.get("saveAs") {
            Some(save_as) if !save_as.is_null() => Some(item_card(
                Document,
                result("documentId")?,
                Created,
                ItemFacts {
                    file_type: Some("pptx".to_owned()),
                    title: text(Some(save_as), "name"),
                    ..ItemFacts::default()
                },
            )),
            _ => Some(item_card(
                Document,
                arg("documentId")?,
                Edited,
                ItemFacts {
                    file_type: Some("pptx".to_owned()),
                    summary: changes_summary(input.get("operations")),
                    ..ItemFacts::default()
                },
            )),
        },
        "RenameDocument" if !refused(output, "success") => Some(item_card(
            Document,
            arg("documentId")?,
            Renamed,
            ItemFacts {
                title: arg("documentName"),
                ..ItemFacts::default()
            },
        )),
        // The text a comment is anchored to is the document's own.
        "CommentOnDocument" => Some(item_card(
            Document,
            result("documentId").or_else(|| arg("documentId"))?,
            Commented,
            ItemFacts::default(),
        )),
        "UploadFile" => {
            let name = result("fileName").or_else(|| arg("fileName"));
            Some(item_card(
                Document,
                result("documentId")?,
                Created,
                ItemFacts {
                    file_type: name.as_deref().and_then(extension),
                    title: name,
                    ..ItemFacts::default()
                },
            ))
        }
        "CreateProject" => Some(item_card(
            Project,
            result("projectId")?,
            Created,
            ItemFacts {
                title: result("projectName"),
                ..ItemFacts::default()
            },
        )),
        // A move without a project takes the item out to the top level.
        "MoveToProject" if !refused(output, "success") => Some(item_card(
            entity_card_type(&arg("entityType")?)?,
            arg("entityId")?,
            Moved,
            ItemFacts {
                summary: input
                    .get("projectId")
                    .is_none_or(serde_json::Value::is_null)
                    .then(|| "to the top level".to_owned()),
                ..ItemFacts::default()
            },
        )),
        "CreateChannel" => Some(item_card(
            Channel,
            result("channelId")?,
            Created,
            ItemFacts {
                title: result("name"),
                ..ItemFacts::default()
            },
        )),
        "RenameChannel" => Some(item_card(
            Channel,
            result("channelId")?,
            Renamed,
            ItemFacts {
                title: result("name"),
                summary: result("previousName").map(|previous| format!("was {previous}")),
                ..ItemFacts::default()
            },
        )),
        // SendChannelMessage's arguments and result keep their Rust names.
        // The post is the channel's to show, to its own members.
        "SendChannelMessage" => Some(item_card(
            Channel,
            result("channel_id").or_else(|| arg("channel_id"))?,
            Sent,
            ItemFacts::default(),
        )),
        "CreateRoutine" => Some(item_card(
            Routine,
            result("id")?,
            Created,
            ItemFacts {
                title: result("name"),
                ..ItemFacts::default()
            },
        )),
        "UpdateRoutine" => {
            let change = input.get("change");
            let enabled = change
                .filter(|change| text(Some(change), "type").as_deref() == Some("enabled"))
                .and_then(|change| change.get("enabled"))
                .and_then(serde_json::Value::as_bool);
            Some(item_card(
                Routine,
                result("id")?,
                Updated,
                ItemFacts {
                    title: result("name"),
                    summary: enabled
                        .map(|enabled| if enabled { "Resumed" } else { "Paused" }.to_owned()),
                    ..ItemFacts::default()
                },
            ))
        }
        "CreateForm" => Some(item_card(
            Form,
            result("formId")?,
            Created,
            ItemFacts {
                title: arg("name"),
                summary: form_state(output),
                ..ItemFacts::default()
            },
        )),
        "EditForm" => Some(item_card(
            Form,
            result("formId").or_else(|| arg("formId"))?,
            Edited,
            ItemFacts {
                summary: form_state(output),
                ..ItemFacts::default()
            },
        )),
        "CreateInitiative" => Some(item_card(
            Initiative,
            result("initiativeId")?,
            Created,
            ItemFacts {
                title: result("name"),
                ..ItemFacts::default()
            },
        )),
        "UpdateInitiative" => Some(item_card(
            Initiative,
            result("initiativeId")?,
            Updated,
            ItemFacts {
                title: result("name"),
                ..ItemFacts::default()
            },
        )),
        // A read the agent asked to show; a query it ran for itself, or a
        // write, is not a card.
        "QueryDatabase" => {
            let display = arg("display")?;
            let statement = output?.get("statement");
            if text(statement, "kind").as_deref() != Some("select") {
                return None;
            }
            Some(ActivityCard::Data {
                sql: arg("sql")?,
                database_id: arg("databaseId"),
                display: Some(display),
            })
        }
        "CreateConfirmedCalendarEvent" => event_card(output?, Created),
        "UpdateCalendarEvent" => event_card(output?, Edited),
        // Deleting part of a series leaves the rest of it.
        "DeleteCalendarEvent" => Some(item_card(
            CalendarEvent,
            result("eventId").or_else(|| arg("eventId"))?,
            Deleted,
            ItemFacts {
                summary: match arg("scope").as_deref() {
                    Some("this_event") => Some("One occurrence".to_owned()),
                    Some("this_and_following") => Some("This and later occurrences".to_owned()),
                    _ => None,
                },
                ..ItemFacts::default()
            },
        )),
        // A send the user already confirmed runs as an ordinary tool.
        "SendConfirmedEmail" => Some(item_card(
            EmailThread,
            text(output?.get("sent"), "thread_id")?,
            Sent,
            ItemFacts {
                title: arg("subject"),
                summary: recipients(input),
                ..ItemFacts::default()
            },
        )),
        // SetEntityProperty's arguments keep their Rust names.
        "SetEntityProperty" if !refused(output, "success") => Some(item_card(
            entity_card_type(&arg("entity_type")?)?,
            arg("entity_id")?,
            Updated,
            ItemFacts::default(),
        )),
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
        UserToolOutcome::Sent { thread_id, .. } if tool == "SendEmail" => Some(item_card(
            CardItemType::EmailThread,
            thread_id.clone(),
            CardAction::Sent,
            ItemFacts {
                title: text(Some(input), "subject"),
                summary: recipients(input),
                ..ItemFacts::default()
            },
        )),
        UserToolOutcome::Completed { result } if tool == "CreateCalendarEvent" => {
            event_card(result, CardAction::Created)
        }
        _ => None,
    }
}

/// A calendar event's card, from the event a calendar tool returned.
fn event_card(event: &serde_json::Value, action: CardAction) -> Option<ActivityCard> {
    Some(item_card(
        CardItemType::CalendarEvent,
        text(Some(event), "eventId")?,
        action,
        ItemFacts {
            title: text(Some(event), "title"),
            ..ItemFacts::default()
        },
    ))
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

/// A user tool's step, by where the user got to with what the agent drafted.
fn user_tool_label(words: &UserToolWords, outcome: &UserToolOutcome) -> &'static str {
    match outcome {
        UserToolOutcome::Pending | UserToolOutcome::Edited => words.drafted,
        UserToolOutcome::Sent { .. }
        | UserToolOutcome::Completed { .. }
        | UserToolOutcome::Unrecognized => words.done,
        UserToolOutcome::Draft { .. } => words.saved,
        UserToolOutcome::Rejected => words.discarded,
        UserToolOutcome::Failed { .. } => words.failed,
    }
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
