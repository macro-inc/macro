//! The folded-message wire vocabulary.
//!
//! One transport shape for [`agent_fold`]'s renderable message model, shared
//! by the two adapters that emit it: the REST endpoint serving a channel's
//! folded messages ([`crate::inbound::axum_router`]) and the realtime event
//! streaming a live session's changes
//! ([`crate::outbound::connection_gateway_realtime`]). A client catching up
//! over HTTP and following over the websocket reads the same bytes, so the
//! two cannot drift - which is the whole reason this module exists outside
//! both adapters rather than inside one of them.
//!
//! The fold's own model ([`agent_fold::domain::model`]) is not serializable,
//! on purpose: it is the fold's vocabulary and owes nothing to any transport.
//! This module is where that debt is paid, once.
//!
//! Multi-word fields in the enums carry explicit `#[serde(rename)]`s instead
//! of `rename_all_fields = "camelCase"`: utoipa does not read
//! `rename_all_fields`, so the explicit form keeps the generated schema and
//! the serialized wire format in agreement.

use agent_fold::domain::log::AgentSessionId;
use agent_fold::domain::model::{
    Author, FileDiff, FoldedMessage, MessagePart, Permission, PermissionOption,
    PermissionOptionKind, PermissionOutcome, StopReason, ToolDetail, ToolStatus, ToolUse,
    composite_message_id,
};
use serde::Serialize;
use utoipa::ToSchema;

/// One renderable message folded from a session's protocol log, mirroring
/// [`FoldedMessage`].
#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FoldedMessageDto {
    /// The composite id the placeholder comms message for this folded message
    /// carries in its `agent_session_message_id`:
    /// `"{agent_session_id}:{turn}:{author}"`. Readers join folded messages
    /// onto placeholder rows by this, one to one.
    pub agent_session_message_id: String,
    /// The turn within the session, assigned in log order from zero.
    pub turn: u32,
    /// Who produced the message.
    pub author: FoldedAuthorDto,
    /// Ordered renderable content. Never empty.
    pub parts: Vec<FoldedMessagePartDto>,
    /// How the turn ended, on the agent message that closed it. Absent while
    /// the turn is in flight or when the session died without a response.
    pub stop: Option<StopReasonDto>,
}

impl FoldedMessageDto {
    /// Map a folded message into its transport shape, stamping the composite
    /// message id of the session it was folded from.
    #[must_use]
    pub fn new(session: AgentSessionId, message: FoldedMessage) -> Self {
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

/// Who produced a folded message, mirroring [`Author`].
#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FoldedAuthorDto {
    /// A person, via `session/prompt`.
    User {
        /// The user's macro id, absent when the prompt was unattributed.
        #[serde(rename = "userId")]
        user_id: Option<String>,
    },
    /// The agent.
    Agent,
}

impl From<Author> for FoldedAuthorDto {
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
#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FoldedMessagePartDto {
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
        /// Where the call got to.
        status: ToolStatusDto,
        /// What the tool did, as far as the log reveals.
        detail: ToolDetailDto,
    },
    /// The agent asking to proceed with a tool call.
    Permission {
        /// The `toolCallId` permission was requested for.
        #[serde(rename = "toolCall")]
        tool_call: String,
        /// The choices offered, in the order ACP listed them.
        options: Vec<PermissionOptionDto>,
        /// What the user chose. Absent while the request is outstanding, or
        /// when it resolved into something the wire does not model - see
        /// [`permission_outcome`].
        outcome: Option<PermissionOutcomeDto>,
    },
}

impl From<MessagePart> for FoldedMessagePartDto {
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
#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ToolStatusDto {
    /// Not started - still streaming input or awaiting permission.
    Pending,
    /// Currently running.
    Running,
    /// Finished successfully.
    Completed,
    /// Finished unsuccessfully.
    Failed,
}

impl From<ToolStatus> for ToolStatusDto {
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
#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ToolDetailDto {
    /// A shell command.
    Terminal {
        /// The command line, when the harness reported one.
        command: Option<String>,
        /// Captured output, ANSI escape sequences left in place - turning
        /// them into something a reader can see is the reader's business.
        output: Option<String>,
        /// Process exit code, when the harness reported one.
        #[serde(rename = "exitCode")]
        exit_code: Option<i32>,
    },
    /// One or more file modifications.
    Edit {
        /// The diffs ACP reported for this call.
        diffs: Vec<FileDiffDto>,
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
        #[schema(value_type = Option<Object>)]
        input: Option<serde_json::Value>,
    },
}

impl From<ToolDetail> for ToolDetailDto {
    fn from(detail: ToolDetail) -> Self {
        match detail {
            ToolDetail::Terminal {
                command,
                output,
                exit_code,
            } => Self::Terminal {
                command,
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
#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FileDiffDto {
    /// The file that changed.
    pub path: String,
    /// Prior contents, absent when the file is new.
    pub old_text: Option<String>,
    /// New contents.
    pub new_text: String,
}

impl From<FileDiff> for FileDiffDto {
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
#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PermissionOptionDto {
    /// The id to report back when this option is chosen.
    pub id: String,
    /// Label to show.
    pub name: String,
    /// What kind of choice this is.
    pub kind: PermissionOptionKindDto,
}

impl From<PermissionOption> for PermissionOptionDto {
    fn from(option: PermissionOption) -> Self {
        Self {
            id: option.id,
            name: option.name,
            kind: option.kind.into(),
        }
    }
}

/// What kind of choice a permission option offers, mirroring
/// [`PermissionOptionKind`] - ACP's wire strings.
#[derive(Debug, Clone, Copy, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum PermissionOptionKindDto {
    /// Allow this operation only this time.
    AllowOnce,
    /// Allow this operation and remember the choice.
    AllowAlways,
    /// Reject this operation only this time.
    RejectOnce,
    /// Reject this operation and remember the choice.
    RejectAlways,
}

impl From<PermissionOptionKind> for PermissionOptionKindDto {
    fn from(kind: PermissionOptionKind) -> Self {
        match kind {
            PermissionOptionKind::AllowOnce => Self::AllowOnce,
            PermissionOptionKind::AllowAlways => Self::AllowAlways,
            PermissionOptionKind::RejectOnce => Self::RejectOnce,
            PermissionOptionKind::RejectAlways => Self::RejectAlways,
        }
    }
}

/// How a permission request resolved, mirroring the resolved half of
/// [`PermissionOutcome`].
#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PermissionOutcomeDto {
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
fn permission_outcome(outcome: PermissionOutcome) -> Option<PermissionOutcomeDto> {
    match outcome {
        PermissionOutcome::Selected { option_id } => {
            Some(PermissionOutcomeDto::Selected { option_id })
        }
        PermissionOutcome::Cancelled => Some(PermissionOutcomeDto::Cancelled),
        PermissionOutcome::Pending
        | PermissionOutcome::Errored
        | PermissionOutcome::Unrecognized => None,
    }
}

/// Why a turn stopped, mirroring [`StopReason`].
#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum StopReasonDto {
    /// The agent finished its turn.
    EndTurn,
    /// The model hit its token limit.
    MaxTokens,
    /// The agent hit its turn-request limit.
    MaxTurnRequests,
    /// The agent declined.
    Refusal,
    /// The turn was cancelled.
    Cancelled,
    /// A stop reason the fold does not model.
    Other {
        /// The wire string.
        reason: String,
    },
}

impl From<StopReason> for StopReasonDto {
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

/// The agent behind a session, mirroring
/// [`SessionBot`](crate::domain::model::SessionBot).
#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SessionBotDto {
    /// The bot's id. A message it sent has `"bot|{id}"` as its sender.
    pub id: macro_uuid::Uuid,
    /// Display name.
    pub name: String,
    /// Avatar, when it has one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
}

impl From<crate::domain::model::SessionBot> for SessionBotDto {
    fn from(bot: crate::domain::model::SessionBot) -> Self {
        Self {
            id: bot.id.as_uuid(),
            name: bot.name,
            avatar_url: bot.avatar_url,
        }
    }
}
