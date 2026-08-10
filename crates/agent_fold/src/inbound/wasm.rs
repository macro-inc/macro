//! The fold, as the browser calls it.
//!
//! Two entry points over one fold. [`fold_session`] takes a session id and
//! that session's whole log and gives back the messages it derives.
//! [`FoldStream`] is the same fold kept open: construct one per live session,
//! push frames as they arrive, and each push reports the single message it
//! changed. The log arrives in exactly the shape the raw-log endpoint serves,
//! a recording stores, and the realtime event carries - `{userId?, direction,
//! content}` per frame - so a caller passes bytes through rather than
//! translating them, and catching up and following are the same code.
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
//! # Why catching up is not a loop of pushes
//!
//! [`FoldStream::extend`] exists rather than leaving a caller to push a
//! fetched log frame by frame. A push serializes the message it changed
//! across the boundary, and a session's frames overwhelmingly change the same
//! agent message over and over - so replaying 6500 frames one at a time would
//! serialize 6500 whole messages to produce one. `extend` folds them all and
//! serializes the answer once.

use crate::domain::fold::{FoldMachineImpl, fold};
use crate::domain::log::{AgentSessionId, AgentSessionLog, Message};
use crate::domain::model::{
    Author, FileDiff, FoldedMessage, IncrementalFoldResult, MessagePart, Permission,
    PermissionOption, PermissionOptionKind, PermissionOutcome, StopReason, ToolDetail, ToolStatus,
    ToolUse, composite_message_id,
};
use crate::domain::ports::FoldMachine;
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
    let session = parse_session(session_id)?;
    let messages = fold(parse_log(session, entries)?);
    encode_messages(session, messages)
}

/// One live session's fold, held open between frames.
///
/// The streaming counterpart to [`fold_session`], wrapping the same
/// [`FoldMachineImpl`] the server folds with. A caller following a session
/// keeps one of these per session for as long as the session lasts: frames
/// must arrive in log order, and the machine only ever grows.
///
/// A client that opens a channel mid-session catches up with [`Self::extend`]
/// and then follows with [`Self::push`] on the *same* machine. Refolding the
/// fetched log into a throwaway and then pushing live frames into a second
/// machine would derive the same messages twice from different halves of the
/// log; there is one machine per session precisely so that cannot happen.
#[wasm_bindgen]
pub struct FoldStream {
    /// Half of the composite id every message this machine derives is keyed
    /// by, and the reason the session id is taken once rather than per frame.
    session: AgentSessionId,
    machine: FoldMachineImpl,
}

#[wasm_bindgen]
impl FoldStream {
    /// A machine for `session_id` that has folded nothing.
    ///
    /// # Errors
    ///
    /// Returns a JS string when the session id is not a UUID.
    #[wasm_bindgen(constructor)]
    pub fn new(session_id: &str) -> Result<FoldStream, JsValue> {
        Ok(Self {
            session: parse_session(session_id)?,
            machine: FoldMachineImpl::new(),
        })
    }

    /// Fold a run of frames in one go, answering with every message derived
    /// so far - the catch-up path. See the module docs for why this is not a
    /// loop of [`Self::push`].
    ///
    /// # Errors
    ///
    /// Returns a JS string when the entries are not log frames.
    pub fn extend(&mut self, entries: JsValue) -> Result<JsValue, JsValue> {
        for entry in parse_log(self.session, entries)? {
            let _ = self.machine.push(entry);
        }
        self.messages()
    }

    /// Fold one more frame, reporting the message it changed as
    /// `{kind: "new" | "update", message}`.
    ///
    /// `null` for a frame that changes nothing renderable - a handshake, a
    /// token-usage report, an update this fold does not model - which is most
    /// of them.
    ///
    /// # Errors
    ///
    /// Returns a JS string when the entry is not a log frame.
    pub fn push(&mut self, entry: JsValue) -> Result<JsValue, JsValue> {
        let entry: LogEntry = serde_wasm_bindgen::from_value(entry)
            .map_err(|error| JsValue::from_str(&format!("log entry is not readable: {error}")))?;

        let result = self.machine.push(entry.into_log(self.session));
        let Some(change) = JsFoldedMessageChange::new(self.session, result) else {
            return Ok(JsValue::NULL);
        };

        serde_wasm_bindgen::to_value(&change).map_err(|error| {
            JsValue::from_str(&format!("folded message is not encodable: {error}"))
        })
    }

    /// Every message folded so far, oldest first.
    ///
    /// The same answer [`fold_session`] gives for the frames pushed so far -
    /// they are one fold - which is what a reader relies on when a channel
    /// that has been following a session is reopened.
    ///
    /// # Errors
    ///
    /// Returns a JS string describing what could not be encoded.
    pub fn messages(&self) -> Result<JsValue, JsValue> {
        let messages: Vec<JsFoldedMessage> = self
            .machine
            .messages()
            .iter()
            .cloned()
            .map(|message| JsFoldedMessage::new(self.session, message))
            .collect();

        serde_wasm_bindgen::to_value(&messages).map_err(|error| {
            JsValue::from_str(&format!("folded messages are not encodable: {error}"))
        })
    }
}

/// The session a caller named, or a JS string saying it is not a session id.
fn parse_session(session_id: &str) -> Result<AgentSessionId, JsValue> {
    session_id
        .parse()
        .map(AgentSessionId::new_from_uuid)
        .map_err(|error| JsValue::from_str(&format!("session id is not a uuid: {error}")))
}

/// Read an array of served log entries as this session's log frames.
fn parse_log(session: AgentSessionId, entries: JsValue) -> Result<Vec<AgentSessionLog>, JsValue> {
    let entries: Vec<LogEntry> = serde_wasm_bindgen::from_value(entries)
        .map_err(|error| JsValue::from_str(&format!("log entries are not readable: {error}")))?;

    Ok(entries
        .into_iter()
        .map(|entry| entry.into_log(session))
        .collect())
}

/// Encode folded messages for the browser.
fn encode_messages(
    session: AgentSessionId,
    messages: Vec<FoldedMessage>,
) -> Result<JsValue, JsValue> {
    let messages: Vec<JsFoldedMessage> = messages
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

/// What one pushed frame changed, mirroring [`IncrementalFoldResult`].
///
/// The message is carried whole rather than as a delta, so a reader applies
/// either kind the same way - replace whatever it holds under this
/// `agentSessionMessageId`. `kind` is what tells it whether a row for that id
/// exists yet: a session streaming into a channel has no placeholder message
/// for a turn until the fold first derives it, and `new` is the one moment
/// the client can create one.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct JsFoldedMessageChange {
    /// `"new"` the first time a message is reported, `"update"` after.
    kind: &'static str,
    message: JsFoldedMessage,
}

impl JsFoldedMessageChange {
    /// `None` for [`IncrementalFoldResult::Unchanged`] - nothing to report.
    fn new(session: AgentSessionId, result: IncrementalFoldResult<'_>) -> Option<Self> {
        let (kind, message) = match result {
            IncrementalFoldResult::NewMessage(message) => ("new", message),
            IncrementalFoldResult::MessageUpdate(message) => ("update", message),
            IncrementalFoldResult::Unchanged => return None,
        };
        Some(Self {
            kind,
            message: JsFoldedMessage::new(session, message.clone()),
        })
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
        /// What the user chose. Absent while the request is outstanding, or
        /// when it resolved into something the wire does not model - see
        /// [`permission_outcome`].
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
                outcome: permission_outcome(outcome),
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
            kind: permission_option_kind_wire(option.kind).to_owned(),
        }
    }
}

/// [`PermissionOption::kind`]'s wire string, the vocabulary
/// `apps/web/src/lib/core/agent-fold/types.ts`'s `PermissionOption.kind` is
/// hand-written against.
fn permission_option_kind_wire(kind: PermissionOptionKind) -> &'static str {
    match kind {
        PermissionOptionKind::AllowOnce => "allow_once",
        PermissionOptionKind::AllowAlways => "allow_always",
        PermissionOptionKind::RejectOnce => "reject_once",
        PermissionOptionKind::RejectAlways => "reject_always",
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

/// [`PermissionOutcome`] as the wire sees it: whether an option was chosen,
/// collapsing every way it was not into absence.
///
/// The wire does not yet distinguish *why* nothing was chosen -
/// [`PermissionOutcome::Pending`], [`PermissionOutcome::Errored`] and
/// [`PermissionOutcome::Unrecognized`] all read as "no outcome" to a reader
/// today. That is a real loss (an errored or unrecognized request will not
/// resolve further, unlike a pending one), but widening the wire to say so is
/// a frontend change of its own, not implied by giving the fold's own state
/// machine a name for each case.
fn permission_outcome(outcome: PermissionOutcome) -> Option<JsPermissionOutcome> {
    match outcome {
        PermissionOutcome::Selected { option_id } => {
            Some(JsPermissionOutcome::Selected { option_id })
        }
        PermissionOutcome::Cancelled => Some(JsPermissionOutcome::Cancelled),
        PermissionOutcome::Pending
        | PermissionOutcome::Errored
        | PermissionOutcome::Unrecognized => None,
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
