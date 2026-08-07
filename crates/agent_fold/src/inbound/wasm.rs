//! The fold, as the browser calls it.
//!
//! One entry point, [`fold_session`]: hand it a session id and that session's
//! log, get back the messages it derives. The log arrives in exactly the shape
//! the raw-log endpoint serves and a recording stores - `{userId?, direction,
//! content}` per frame - so the caller passes the response through rather than
//! translating it.
//!
//! # Why the types are written out again
//!
//! [`crate::domain::model`] is not serializable, on purpose: it is the fold's
//! own vocabulary and owes nothing to any transport. So this module declares
//! the shape JavaScript sees, the same way the HTTP handler used to before the
//! fold moved to the client. The pairing to keep honest is with
//! `apps/web/src/lib/core/agent-fold/types.ts`, which is hand-written against
//! these - enums tagged with `kind`, fields camelCase.
//!
//! # Why it returns everything at once
//!
//! The incremental machine ([`crate::domain::fold::FoldMachineImpl`]) is the
//! better fit for a live session and this will grow a push-shaped entry point
//! to match. A channel load is a different job: it has the whole log in hand
//! and wants the whole answer, and folding 6500 frames takes single-digit
//! milliseconds, so there is nothing to stream yet.

use crate::domain::fold::fold;
use crate::domain::log::{AgentSessionId, AgentSessionLog, Message};
use crate::domain::model::{
    Author, FileDiff, FoldedMessage, MessagePart, Permission, PermissionOption, PermissionOutcome,
    StopReason, ToolDetail, ToolStatus, ToolUse, composite_message_id,
};
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

/// Fold one session's log into the messages a channel renders.
///
/// `session_id` is the session the entries belong to; it is not repeated per
/// entry, and it is what the returned `agentSessionMessageId`s are built from.
///
/// Errors only on input this cannot read - a session id that is not a UUID, or
/// entries that are not log frames. The fold itself is total: an unrecognized
/// or half-finished frame yields a partially-known message rather than a
/// failure, because rendering some of a session always beats rendering none.
///
/// # Errors
///
/// Returns a JS string describing what could not be read.
#[wasm_bindgen]
pub fn fold_session(session_id: &str, entries: JsValue) -> Result<JsValue, JsValue> {
    let session = session_id
        .parse()
        .map(AgentSessionId::new_from_uuid)
        .map_err(|error| JsValue::from_str(&format!("session id is not a uuid: {error}")))?;

    let entries: Vec<LogEntry> = serde_wasm_bindgen::from_value(entries)
        .map_err(|error| JsValue::from_str(&format!("log entries are not readable: {error}")))?;

    let log = entries
        .into_iter()
        .map(|entry| entry.into_log(session))
        .collect::<Vec<_>>();

    let messages: Vec<JsFoldedMessage> = fold(log)
        .into_iter()
        .map(|message| JsFoldedMessage::new(session, message))
        .collect();

    serde_wasm_bindgen::to_value(&messages)
        .map_err(|error| JsValue::from_str(&format!("folded messages are not encodable: {error}")))
}

/// One entry of a session's protocol log, as the endpoint serves it.
#[derive(Deserialize)]
struct LogEntry {
    /// The user whose action produced the frame, when one did. Absent on
    /// everything the runtime originated.
    #[serde(rename = "userId", default)]
    user_id: Option<String>,
    /// `direction` and `content`, flattened in - the frame's own two fields.
    #[serde(flatten)]
    message: Message,
}

impl LogEntry {
    fn into_log(self, session: AgentSessionId) -> AgentSessionLog {
        AgentSessionLog {
            agent_session_id: session,
            // A user id that will not parse is dropped rather than rejected:
            // it costs the prompt its attribution, and the placeholder row it
            // renders into carries a sender of its own anyway.
            user_id: self
                .user_id
                .and_then(|id| MacroUserIdStr::try_from(id).ok()),
            content: self.message,
        }
    }
}

/// One renderable message, mirroring [`FoldedMessage`].
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct JsFoldedMessage {
    /// The composite id the placeholder comms message for this folded message
    /// carries in its `agent_session_message_id`. Readers join folded messages
    /// onto placeholder rows by this, one to one.
    agent_session_message_id: String,
    /// The turn within the session, assigned in log order from zero.
    turn: u32,
    author: JsAuthor,
    /// Ordered renderable content. Never empty.
    parts: Vec<JsMessagePart>,
    /// How the turn ended, on the agent message that closed it. Absent while
    /// the turn is in flight, or when the session died without a response.
    #[serde(skip_serializing_if = "Option::is_none")]
    stop: Option<JsStopReason>,
}

impl JsFoldedMessage {
    fn new(session: AgentSessionId, message: FoldedMessage) -> Self {
        Self {
            agent_session_message_id: composite_message_id(session, message.id()),
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

/// Who produced a message, mirroring [`Author`].
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum JsAuthor {
    /// A person, via `session/prompt`.
    User {
        /// Absent when the prompt was not attributed to anyone.
        #[serde(rename = "userId", skip_serializing_if = "Option::is_none")]
        user_id: Option<String>,
    },
    /// The agent.
    Agent,
}

impl From<Author> for JsAuthor {
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
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum JsMessagePart {
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
        status: JsToolStatus,
        detail: JsToolDetail,
    },
    /// The agent asking to proceed with a tool call.
    Permission {
        /// The `toolCallId` permission was requested for.
        #[serde(rename = "toolCall")]
        tool_call: String,
        /// The choices offered, in the order ACP listed them.
        options: Vec<JsPermissionOption>,
        /// What the user chose. Absent while the request is outstanding.
        #[serde(skip_serializing_if = "Option::is_none")]
        outcome: Option<JsPermissionOutcome>,
    },
}

impl From<MessagePart> for JsMessagePart {
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
                outcome: outcome.map(Into::into),
            },
        }
    }
}

/// How far a tool call progressed, mirroring [`ToolStatus`].
#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
enum JsToolStatus {
    Pending,
    Running,
    Completed,
    Failed,
}

impl From<ToolStatus> for JsToolStatus {
    fn from(status: ToolStatus) -> Self {
        match status {
            ToolStatus::Pending => Self::Pending,
            ToolStatus::Running => Self::Running,
            ToolStatus::Completed => Self::Completed,
            ToolStatus::Failed => Self::Failed,
        }
    }
}

/// What a tool call actually did, mirroring [`ToolDetail`].
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum JsToolDetail {
    /// A shell command.
    Terminal {
        /// The command line, when the harness reported one.
        #[serde(skip_serializing_if = "Option::is_none")]
        command: Option<String>,
        /// Captured output, ANSI escape sequences left in place.
        #[serde(skip_serializing_if = "Option::is_none")]
        output: Option<String>,
        /// Process exit code, when the harness reported one.
        #[serde(rename = "exitCode", skip_serializing_if = "Option::is_none")]
        exit_code: Option<i32>,
    },
    /// One or more file modifications.
    Edit {
        /// The diffs ACP reported for this call.
        diffs: Vec<JsFileDiff>,
    },
    /// A file read.
    Read {
        /// Paths this call touched.
        paths: Vec<String>,
    },
    /// Anything else, including tools the fold has no special rendering for.
    Other {
        /// ACP's tool kind, as its wire string.
        #[serde(rename = "acpKind")]
        acp_kind: String,
        /// The tool's input, when reported.
        #[serde(skip_serializing_if = "Option::is_none")]
        input: Option<serde_json::Value>,
    },
}

impl From<ToolDetail> for JsToolDetail {
    fn from(detail: ToolDetail) -> Self {
        match detail {
            ToolDetail::Terminal {
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
            ToolDetail::Edit { diffs } => Self::Edit {
                diffs: diffs.into_iter().map(Into::into).collect(),
            },
            ToolDetail::Read { paths } => Self::Read {
                paths: paths
                    .into_iter()
                    .map(|path| path.to_string_lossy().into_owned())
                    .collect(),
            },
            ToolDetail::Other { kind, input } => Self::Other {
                acp_kind: kind,
                input,
            },
        }
    }
}

/// A file modification a tool reported, mirroring [`FileDiff`].
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct JsFileDiff {
    /// The file that changed.
    path: String,
    /// Prior contents, absent when the file is new.
    #[serde(skip_serializing_if = "Option::is_none")]
    old_text: Option<String>,
    /// New contents.
    new_text: String,
}

impl From<FileDiff> for JsFileDiff {
    fn from(diff: FileDiff) -> Self {
        Self {
            path: diff.path.to_string_lossy().into_owned(),
            old_text: diff.old_text,
            new_text: diff.new_text,
        }
    }
}

/// One choice offered for a permission request, mirroring
/// [`PermissionOption`].
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct JsPermissionOption {
    /// The id to report back when this option is chosen.
    id: String,
    /// Label to show.
    name: String,
    /// ACP's option kind, as its wire string.
    kind: String,
}

impl From<PermissionOption> for JsPermissionOption {
    fn from(option: PermissionOption) -> Self {
        Self {
            id: option.id,
            name: option.name,
            kind: option.kind,
        }
    }
}

/// How a permission request resolved, mirroring [`PermissionOutcome`].
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum JsPermissionOutcome {
    /// An option was chosen.
    Selected {
        /// The chosen option's id.
        #[serde(rename = "optionId")]
        option_id: String,
    },
    /// The request was cancelled without a choice.
    Cancelled,
}

impl From<PermissionOutcome> for JsPermissionOutcome {
    fn from(outcome: PermissionOutcome) -> Self {
        match outcome {
            PermissionOutcome::Selected { option_id } => Self::Selected { option_id },
            PermissionOutcome::Cancelled => Self::Cancelled,
        }
    }
}

/// Why a turn stopped, mirroring [`StopReason`].
#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum JsStopReason {
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

impl From<StopReason> for JsStopReason {
    fn from(stop: StopReason) -> Self {
        match stop {
            StopReason::EndTurn => Self::EndTurn,
            StopReason::MaxTokens => Self::MaxTokens,
            StopReason::MaxTurnRequests => Self::MaxTurnRequests,
            StopReason::Refusal => Self::Refusal,
            StopReason::Cancelled => Self::Cancelled,
            StopReason::Other(reason) => Self::Other { reason },
        }
    }
}
