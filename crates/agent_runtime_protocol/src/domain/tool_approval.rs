//! The log frame an MCP tool call held for the owner's approval leaves.
//!
//! The egress proxy holds a `tools/call` made during a turn somebody other
//! than the session's owner prompted, until the owner approves it. The proxy
//! is not the agent and not the session actor, so what it records is an ACP
//! extension notification (`_macro/...`, which ACP reserves for exactly this)
//! logged in the runtime's direction: it is about the runtime's own traffic,
//! and every existing reader of the log already accepts any JSON-RPC frame
//! there and ignores methods it does not know.
//!
//! One frame per state: `pending` when the call is held, then one terminal
//! frame when it is resolved. The fold pairs them by `approvalId`.

use agent_client_protocol::{RawJsonRpcMessage, RawJsonRpcParams};
use serde::{Deserialize, Serialize};
use specta::Type;

use super::schema::v0::{AcpMessage, ToServerMessage};

#[cfg(test)]
mod test;

/// The extension method the frame is logged under.
pub const TOOL_APPROVAL_METHOD: &str = "_macro/tool_approval";

/// Where a held call stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ToolApprovalStatus {
    /// Held until the owner answers.
    Pending,
    /// The owner approved it; the call went through.
    Approved,
    /// The owner refused it; the call did not run.
    Denied,
    /// Someone with edit access, the agent, or the session gave up on it.
    Cancelled,
    /// Nobody answered in time.
    Expired,
}

impl ToolApprovalStatus {
    /// The stored and wire spelling.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Approved => "approved",
            Self::Denied => "denied",
            Self::Cancelled => "cancelled",
            Self::Expired => "expired",
        }
    }

    /// Read a stored spelling back.
    #[must_use]
    pub fn parse(value: &str) -> Option<Self> {
        Some(match value {
            "pending" => Self::Pending,
            "approved" => Self::Approved,
            "denied" => Self::Denied,
            "cancelled" => Self::Cancelled,
            "expired" => Self::Expired,
            _ => return None,
        })
    }

    /// Whether the call is still waiting on an answer.
    #[must_use]
    pub fn is_pending(self) -> bool {
        self == Self::Pending
    }
}

/// One held call, as the log records it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ToolApprovalNotice {
    /// The approval's id, shared by its pending and terminal frames.
    pub approval_id: String,
    /// `macro` for Macro's own server, otherwise the connected app's slug.
    pub server_slug: String,
    /// What a person calls the server.
    pub server_name: String,
    /// The tool the agent called.
    pub tool_name: String,
    /// The arguments it called the tool with.
    #[specta(type = specta_typescript::Unknown)]
    pub arguments: serde_json::Value,
    /// Who prompted the turn; absent when a bot acted on nobody's behalf.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub requested_by: Option<String>,
    /// Where it stands.
    pub status: ToolApprovalStatus,
    /// Who resolved it, when a person did.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolved_by: Option<String>,
}

impl ToolApprovalNotice {
    /// The frame to log.
    ///
    /// # Panics
    ///
    /// Never: the notice is plain data and always serializes.
    #[must_use]
    pub fn to_server_message(&self) -> ToServerMessage {
        let params = serde_json::to_value(self).expect("a notice serializes");
        let frame = RawJsonRpcMessage::notification(TOOL_APPROVAL_METHOD.to_owned(), params)
            .expect("an object is valid notification params");
        ToServerMessage::Acp(AcpMessage(frame))
    }

    /// Read a notice off a logged notification, if it is one.
    #[must_use]
    pub fn from_notification(method: &str, params: Option<&RawJsonRpcParams>) -> Option<Self> {
        if method != TOOL_APPROVAL_METHOD {
            return None;
        }
        match params? {
            RawJsonRpcParams::Object(map) => {
                serde_json::from_value(serde_json::Value::Object(map.clone())).ok()
            }
            RawJsonRpcParams::Array(_) => None,
        }
    }
}
