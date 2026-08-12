//! The wire shape a browser sees, independent of how it gets there.
//!
//! [`crate::domain::model`] is not serializable, on purpose: it is the fold's
//! own vocabulary and owes nothing to any transport. These types declare the
//! shape JavaScript sees instead - enums tagged with `kind`, fields camelCase
//! - the same way the HTTP handler used to before the fold moved to the
//! client.
//!
//! Kept apart from [`crate::inbound::wasm`], which is wasm32-only, so a
//! native binary can derive `apps/web/src/lib/service-clients/service-agent-fold/generated/types.ts` from
//! these with specta (`cargo run -p agent_fold --bin export_types`) instead
//! of a human keeping that file in sync by hand. Every domain counterpart
//! this module mirrors shares its exact name, so the import list below
//! aliases each one that would otherwise collide with the wire type declared
//! against it - the wire type keeps the bare name, since that is the one
//! specta exports and the one a consumer of this module actually wants.

use crate::domain::log::AgentSessionId;
use crate::domain::model::{
    Author, FileDiff as ModelFileDiff, FoldedMessage as ModelFoldedMessage, IncrementalFoldResult,
    MessagePart, Permission, PermissionOption as ModelPermissionOption, PermissionOptionKind,
    PermissionOutcome as ModelPermissionOutcome, StopReason as ModelStopReason,
    ToolDetail as ModelToolDetail, ToolStatus as ModelToolStatus, ToolUse,
};
use serde::Serialize;
use specta::Type;
use std::path::PathBuf;

/// One renderable message, mirroring [`crate::domain::model::FoldedMessage`].
#[derive(Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FoldedMessage {
    /// Session that scopes this message id.
    agent_session_id: String,
    /// The turn within the session, assigned in log order from zero.
    turn: u32,
    author: FoldedAuthor,
    /// Ordered renderable content. Never empty.
    parts: Vec<FoldedMessagePart>,
    /// How the turn ended, on the agent message that closed it. Absent while
    /// the turn is in flight, or when the session died without a response.
    stop: Option<StopReason>,
}

impl FoldedMessage {
    /// Build the wire form of `message`, keyed to `session`.
    #[must_use]
    pub fn new(session: AgentSessionId, message: ModelFoldedMessage) -> Self {
        Self {
            agent_session_id: session.to_string(),
            turn: message.id.0,
            author: message.author.into(),
            parts: message
                .parts
                .into_inner()
                .into_iter()
                .map(Into::into)
                .collect(),
            stop: message.stop.map(Into::into),
        }
    }
}

/// What one pushed frame changed, mirroring [`IncrementalFoldResult`].
///
/// The message is carried whole rather than as a delta, so a reader applies
/// either kind the same way - replace whatever it holds under this session,
/// turn, and author. `kind` is what tells it whether a row for that id
/// exists yet: a session streaming into a channel has no placeholder message
/// for a turn until the fold first derives it, and `new` is the one moment
/// the client can create one.
#[derive(Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FoldedMessageChange {
    /// `"new"` the first time a message is reported, `"update"` after.
    kind: &'static str,
    message: FoldedMessage,
}

impl FoldedMessageChange {
    /// `None` for [`IncrementalFoldResult::Unchanged`] - nothing to report.
    #[must_use]
    pub fn new(session: AgentSessionId, result: IncrementalFoldResult<'_>) -> Option<Self> {
        let (kind, message) = match result {
            IncrementalFoldResult::NewMessage(message) => ("new", message),
            IncrementalFoldResult::MessageUpdate(message) => ("update", message),
            IncrementalFoldResult::Unchanged => return None,
        };
        Some(Self {
            kind,
            message: FoldedMessage::new(session, message.into_owned()),
        })
    }
}

/// Who produced a message, mirroring [`Author`].
#[derive(Serialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum FoldedAuthor {
    /// A person, via `session/prompt`.
    User {
        /// Absent when the prompt was not attributed to anyone.
        #[serde(rename = "userId")]
        user_id: Option<String>,
    },
    /// The agent.
    Agent,
}

impl From<Author> for FoldedAuthor {
    fn from(author: Author) -> Self {
        match author {
            Author::User(user_id) => Self::User {
                user_id: user_id.map(|id| id.to_string()),
            },
            Author::Agent => Self::Agent,
        }
    }
}

/// A unit of renderable content, mirroring [`MessagePart`].
#[derive(Serialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum FoldedMessagePart {
    /// Prose from the user or the agent.
    Text {
        /// The prose.
        text: String,
    },
    /// The agent's reasoning, which a reader may want to hide by default.
    Thought {
        /// The reasoning.
        text: String,
    },
    /// A tool the agent invoked.
    ToolUse {
        /// The ACP `toolCallId`.
        id: String,
        /// What to show as the tool's name.
        label: String,
        status: ToolStatus,
        detail: ToolDetail,
    },
    /// The agent asking to proceed with a tool call.
    Permission {
        /// The `toolCallId` permission was requested for.
        #[serde(rename = "toolCall")]
        tool_call: String,
        /// The choices offered, in the order ACP listed them.
        options: Vec<PermissionOption>,
        /// What the user chose. Absent while the request is outstanding, or
        /// when it resolved into something the wire does not model - see
        /// [`permission_outcome`].
        outcome: Option<PermissionOutcome>,
    },
}

impl From<MessagePart> for FoldedMessagePart {
    fn from(part: MessagePart) -> Self {
        match part {
            MessagePart::Text(text) => Self::Text { text },
            MessagePart::Thought(text) => Self::Thought { text },
            MessagePart::ToolUse(ToolUse {
                id,
                label,
                status,
                detail,
            }) => Self::ToolUse {
                id: id.0,
                label,
                status: status.into(),
                detail: detail.into(),
            },
            MessagePart::Permission(Permission {
                tool_call,
                options,
                outcome,
            }) => Self::Permission {
                tool_call: tool_call.0,
                options: options.into_iter().map(Into::into).collect(),
                outcome: permission_outcome(outcome),
            },
        }
    }
}

/// How far a tool call progressed, mirroring [`crate::domain::model::ToolStatus`].
#[derive(Serialize, Type)]
#[serde(rename_all = "snake_case")]
enum ToolStatus {
    Pending,
    Running,
    Completed,
    Failed,
}

impl From<ModelToolStatus> for ToolStatus {
    fn from(status: ModelToolStatus) -> Self {
        match status {
            ModelToolStatus::Pending => Self::Pending,
            ModelToolStatus::Running => Self::Running,
            ModelToolStatus::Completed => Self::Completed,
            ModelToolStatus::Failed => Self::Failed,
        }
    }
}

/// What a tool call actually did, mirroring [`crate::domain::model::ToolDetail`].
#[derive(Serialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum ToolDetail {
    /// A shell command.
    Terminal {
        /// The command line, when the harness reported one.
        command: Option<String>,
        /// Captured output, ANSI escape sequences left in place.
        output: Option<String>,
        /// Process exit code, when the harness reported one.
        #[serde(rename = "exitCode")]
        exit_code: Option<i32>,
    },
    /// One or more file modifications.
    Edit {
        /// The diffs ACP reported for this call.
        diffs: Vec<FileDiff>,
    },
    /// A file read.
    Read {
        /// Paths this call touched.
        paths: Vec<String>,
    },
    /// One or more files removed.
    Delete {
        /// Paths this call touched.
        paths: Vec<String>,
    },
    /// One or more files moved or renamed.
    Move {
        /// Paths this call touched.
        paths: Vec<String>,
    },
    /// A search.
    Search {
        /// Paths this call touched.
        paths: Vec<String>,
        /// Text the call reported, when any.
        output: Option<String>,
    },
    /// Retrieving external data.
    Fetch {
        /// Text the call reported, when any.
        output: Option<String>,
    },
    /// Explicit reasoning surfaced as its own tool call.
    Think {
        /// Text the call reported, when any.
        output: Option<String>,
    },
    /// Anything else, including tools the fold has no special rendering for.
    Other {
        /// ACP's tool kind, as its wire string.
        #[serde(rename = "acpKind")]
        acp_kind: String,
        /// Text the call reported, when any.
        output: Option<String>,
        /// The tool's input, when reported.
        ///
        /// Typed as `unknown` on the wire rather than a faithful JSON value:
        /// `serde_json::Value` can hold a `Number` wide enough to lose
        /// precision in `JSON.parse`, which specta refuses to export at all,
        /// and this is opaque, pass-through input a reader treats as such
        /// anyway.
        #[specta(type = specta_typescript::Unknown)]
        input: Option<serde_json::Value>,
    },
}

/// A tool call's paths, as the wire sees them.
fn wire_paths(paths: Vec<PathBuf>) -> Vec<String> {
    paths
        .into_iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect()
}

impl From<ModelToolDetail> for ToolDetail {
    fn from(detail: ModelToolDetail) -> Self {
        match detail {
            ModelToolDetail::Terminal {
                command,
                output,
                exit_code,
            } => Self::Terminal {
                command,
                // The escapes survive the fold; turning them into something a
                // reader can see is the reader's business, not this crate's.
                output: output.map(|output| output.0),
                exit_code,
            },
            ModelToolDetail::Edit { diffs } => Self::Edit {
                diffs: diffs.into_iter().map(Into::into).collect(),
            },
            ModelToolDetail::Read { paths } => Self::Read {
                paths: wire_paths(paths),
            },
            ModelToolDetail::Delete { paths } => Self::Delete {
                paths: wire_paths(paths),
            },
            ModelToolDetail::Move { paths } => Self::Move {
                paths: wire_paths(paths),
            },
            ModelToolDetail::Search { paths, output } => Self::Search {
                paths: wire_paths(paths),
                output,
            },
            ModelToolDetail::Fetch { output } => Self::Fetch { output },
            ModelToolDetail::Think { output } => Self::Think { output },
            ModelToolDetail::Other {
                kind,
                output,
                input,
            } => Self::Other {
                acp_kind: kind,
                output,
                input,
            },
        }
    }
}

/// A file modification a tool reported, mirroring [`crate::domain::model::FileDiff`].
#[derive(Serialize, Type)]
#[serde(rename_all = "camelCase")]
struct FileDiff {
    /// The file that changed.
    path: String,
    /// Prior contents, absent when the file is new.
    old_text: Option<String>,
    /// New contents.
    new_text: String,
}

impl From<ModelFileDiff> for FileDiff {
    fn from(diff: ModelFileDiff) -> Self {
        Self {
            path: diff.path.to_string_lossy().into_owned(),
            old_text: diff.old_text,
            new_text: diff.new_text,
        }
    }
}

/// One choice offered for a permission request, mirroring
/// [`crate::domain::model::PermissionOption`].
#[derive(Serialize, Type)]
#[serde(rename_all = "camelCase")]
struct PermissionOption {
    /// The id to report back when this option is chosen.
    id: String,
    /// Label to show.
    name: String,
    /// ACP's option kind, as its wire string.
    kind: String,
}

impl From<ModelPermissionOption> for PermissionOption {
    fn from(option: ModelPermissionOption) -> Self {
        Self {
            id: option.id,
            name: option.name,
            kind: permission_option_kind_wire(option.kind).to_owned(),
        }
    }
}

/// [`PermissionOption::kind`]'s wire string, the vocabulary
/// `apps/web/src/lib/service-clients/service-agent-fold/generated/types.ts`'s `PermissionOption.kind` is
/// generated against.
fn permission_option_kind_wire(kind: PermissionOptionKind) -> &'static str {
    match kind {
        PermissionOptionKind::AllowOnce => "allow_once",
        PermissionOptionKind::AllowAlways => "allow_always",
        PermissionOptionKind::RejectOnce => "reject_once",
        PermissionOptionKind::RejectAlways => "reject_always",
    }
}

/// How a permission request resolved, mirroring
/// [`crate::domain::model::PermissionOutcome`].
#[derive(Serialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum PermissionOutcome {
    /// An option was chosen.
    Selected {
        /// The chosen option's id.
        #[serde(rename = "optionId")]
        option_id: String,
    },
    /// The request was cancelled without a choice.
    Cancelled,
}

/// [`ModelPermissionOutcome`] as the wire sees it: whether an option was
/// chosen, collapsing every way it was not into absence.
///
/// The wire does not yet distinguish *why* nothing was chosen -
/// [`ModelPermissionOutcome::Pending`], [`ModelPermissionOutcome::Errored`]
/// and [`ModelPermissionOutcome::Unrecognized`] all read as "no outcome" to a
/// reader today. That is a real loss (an errored or unrecognized request will
/// not resolve further, unlike a pending one), but widening the wire to say
/// so is a frontend change of its own, not implied by giving the fold's own
/// state machine a name for each case.
fn permission_outcome(outcome: ModelPermissionOutcome) -> Option<PermissionOutcome> {
    match outcome {
        ModelPermissionOutcome::Selected { option_id } => {
            Some(PermissionOutcome::Selected { option_id })
        }
        ModelPermissionOutcome::Cancelled => Some(PermissionOutcome::Cancelled),
        ModelPermissionOutcome::Pending
        | ModelPermissionOutcome::Errored
        | ModelPermissionOutcome::Unrecognized => None,
    }
}

/// Why a turn stopped, mirroring [`crate::domain::model::StopReason`].
#[derive(Serialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum StopReason {
    EndTurn,
    MaxTokens,
    MaxTurnRequests,
    Refusal,
    Cancelled,
    /// A stop reason this fold does not model, as its wire string.
    Other {
        /// The wire string.
        reason: String,
    },
}

impl From<ModelStopReason> for StopReason {
    fn from(stop: ModelStopReason) -> Self {
        match stop {
            ModelStopReason::EndTurn => Self::EndTurn,
            ModelStopReason::MaxTokens => Self::MaxTokens,
            ModelStopReason::MaxTurnRequests => Self::MaxTurnRequests,
            ModelStopReason::Refusal => Self::Refusal,
            ModelStopReason::Cancelled => Self::Cancelled,
            ModelStopReason::Other(reason) => Self::Other { reason },
        }
    }
}
