//! The parts a message is made of, and why a turn stopped.

use std::str::FromStr;

use serde::Serialize;
use specta::Type;

use super::ToolUseId;
use super::permission::{PermissionOption, PermissionOutcome};
use super::plan::PlanEntry;
use super::tool::{ToolDetail, ToolName, ToolStatus};

/// A unit of renderable content.
#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum MessagePart {
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
        id: ToolUseId,
        /// What the harness called the tool.
        name: ToolName,
        /// Where the call got to.
        status: ToolStatus,
        /// What the tool did, as far as the log reveals.
        detail: ToolDetail,
    },
    /// The agent asking to proceed.
    Permission {
        /// The tool call permission was requested for.
        #[serde(rename = "toolCall")]
        tool_call: ToolUseId,
        /// The choices offered, in the order ACP listed them.
        options: Vec<PermissionOption>,
        /// How the request has resolved so far.
        outcome: PermissionOutcome,
    },
    /// A user-issued control operation on the session.
    Control {
        /// The requested operation.
        control: Control,
        /// How the runtime disposed of it so far.
        outcome: ControlOutcome,
    },
    /// The agent's working todo list for the turn.
    Plan {
        /// The tasks, in the order the agent listed them.
        entries: Vec<PlanEntry>,
    },
}

impl MessagePart {
    /// The parts nested inside this one: a subagent's own parts. `None` for
    /// every other kind.
    #[must_use]
    pub fn children_mut(&mut self) -> Option<&mut Vec<MessagePart>> {
        match self {
            Self::ToolUse {
                detail: ToolDetail::Subagent { children, .. },
                ..
            } => Some(children),
            _ => None,
        }
    }

    /// The parts nested inside this one, read-only. See [`Self::children_mut`].
    #[must_use]
    pub fn children(&self) -> &[MessagePart] {
        match self {
            Self::ToolUse {
                detail: ToolDetail::Subagent { children, .. },
                ..
            } => children,
            _ => &[],
        }
    }
}

/// A session control operation shown in the conversation timeline.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Control {
    /// The runtime was asked to switch models.
    SetModel {
        /// The model slug requested by the caller.
        model: String,
    },
    /// The runtime was asked to compact its context.
    Compact,
    /// The runtime was asked to stop its current work.
    Stop,
}

/// How the runtime disposed of a [`Control`], like [`PermissionOutcome`] for
/// permission requests. Pending is a legitimate final state: a control the
/// session died before answering stays pending.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ControlOutcome {
    /// No response yet.
    Pending,
    /// Acknowledged - immediately so for a stop, which nothing can answer.
    Accepted,
    /// Answered with a JSON-RPC error.
    Rejected {
        /// The error's message, verbatim.
        message: String,
    },
}

/// Why a turn stopped.
///
/// All but one variant is parsed straight off ACP's `stopReason` wire string
/// by [`FromStr`]: the `snake_case` variant names are the wire names, and
/// anything unmodelled falls through to [`Self::Other`], so parsing never
/// fails. [`Self::Failed`] is the exception - no wire string produces it,
/// because it is what a turn that got no `stopReason` at all stopped for.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum StopReason {
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
    /// A stop reason this fold does not model, as its wire string.
    Other {
        /// The unrecognized wire value.
        reason: String,
    },
    /// The runtime answered the prompt with a JSON-RPC error, so the turn
    /// produced no reply and never will.
    ///
    /// Constructed by the fold, never parsed: an error response carries no
    /// `stopReason` to read. Modelled as a stop reason rather than as
    /// something alongside one because that is what it is - a turn that
    /// ended - and because every reader already asks `stop` whether a turn
    /// is still running. A turn left with no stop reason reads as forever in
    /// flight, which is how a failed prompt used to wedge a session.
    Failed {
        /// The runtime's error message, verbatim.
        message: String,
    },
}

impl FromStr for StopReason {
    type Err = std::convert::Infallible;

    fn from_str(reason: &str) -> Result<Self, Self::Err> {
        Ok(match reason {
            "end_turn" => Self::EndTurn,
            "max_tokens" => Self::MaxTokens,
            "max_turn_requests" => Self::MaxTurnRequests,
            "refusal" => Self::Refusal,
            "cancelled" => Self::Cancelled,
            reason => Self::Other {
                reason: reason.to_owned(),
            },
        })
    }
}
