//! Live requests awaiting a user's response, separate from transcript history.

use serde::Serialize;
use specta::Type;

use super::{AgentRequestId, PendingElicitation, PermissionOption, ToolUseId};

/// An answerable request. Each variant retains its own response semantics.
#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PendingInteraction {
    /// A choice among the permission options offered by the agent.
    Permission(PendingPermission),
    /// A form, URL consent, or user tool review.
    Elicitation(PendingElicitation),
    /// An MCP tool call held until the session's owner approves it. Only
    /// the owner may approve or decline; anyone with edit access may cancel.
    ToolApproval(PendingToolApproval),
}

impl PendingInteraction {
    /// The turn that asked for this response.
    #[must_use]
    pub fn turn(&self) -> u32 {
        match self {
            Self::Permission(pending) => pending.turn,
            Self::Elicitation(pending) => pending.turn,
            Self::ToolApproval(pending) => pending.turn,
        }
    }
}

/// A permission request the current connection can still answer.
#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PendingPermission {
    /// The agent's request id, preserving numeric and string identities.
    pub request_id: AgentRequestId,
    /// The turn that asked.
    pub turn: u32,
    /// The tool whose execution needs permission.
    pub tool_call: ToolUseId,
    /// The options the agent offered.
    pub options: Vec<PermissionOption>,
}

/// A held MCP tool call the owner can still answer.
#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PendingToolApproval {
    /// The approval an answer names.
    pub approval_id: String,
    /// The turn the call was made in.
    pub turn: u32,
    /// `macro`, or the connected app's slug.
    pub server_slug: String,
    /// What a person calls the server the tool is on.
    pub server_name: String,
    /// The tool called.
    pub tool_name: String,
    /// Who prompted the turn; absent for a bot on nobody's behalf.
    pub requested_by: Option<String>,
}
