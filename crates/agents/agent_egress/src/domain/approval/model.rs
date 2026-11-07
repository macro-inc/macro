//! What a held call is, and what a person answers it with.

use std::fmt;

use agent_runtime_protocol::domain::action::AgentActionId;
use agent_runtime_protocol::domain::tool_approval::{ToolApprovalNotice, ToolApprovalStatus};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;

use super::MACRO_SERVER_SLUG;
use crate::domain::error::EgressError;
use crate::domain::model::AgentSessionId;

/// Identifies one held call.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct ToolApprovalId(Uuid);

impl ToolApprovalId {
    /// A fresh id, time-ordered.
    #[must_use]
    pub fn mint() -> Self {
        Self(macro_uuid::generate_uuid_v7())
    }

    /// Wrap a stored id.
    #[must_use]
    pub fn from_uuid(id: Uuid) -> Self {
        Self(id)
    }

    /// The id as stored.
    #[must_use]
    pub fn as_uuid(&self) -> Uuid {
        self.0
    }
}

impl fmt::Display for ToolApprovalId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

/// One held call and where it stands.
#[derive(Clone, Debug, PartialEq)]
pub struct ToolApproval {
    /// Its id.
    pub id: ToolApprovalId,
    /// The session whose agent made the call.
    pub session: AgentSessionId,
    /// The turn it was made in.
    pub turn_action_id: AgentActionId,
    /// The call's JSON-RPC id.
    pub request_id: serde_json::Value,
    /// The owner whose access the call spends; the only one who may approve
    /// or decline it.
    pub owner: MacroUserIdStr<'static>,
    /// Who prompted the turn; `None` for a bot on nobody's behalf.
    pub requested_by: Option<MacroUserIdStr<'static>>,
    /// `macro`, or the connected app's slug.
    pub server_slug: String,
    /// What a person calls the server.
    pub server_name: String,
    /// The tool called.
    pub tool_name: String,
    /// What it was called with.
    pub arguments: serde_json::Value,
    /// Where it stands.
    pub status: ToolApprovalStatus,
    /// Who resolved it, when a person did.
    pub resolved_by: Option<MacroUserIdStr<'static>>,
    /// Approved for good: the person who asked may make the calls it covers
    /// without the owner being asked again.
    pub remembered: bool,
}

impl ToolApproval {
    /// The frame the session's log records for this state.
    #[must_use]
    pub fn notice(&self) -> ToolApprovalNotice {
        ToolApprovalNotice {
            approval_id: self.id.to_string(),
            server_slug: self.server_slug.clone(),
            server_name: self.server_name.clone(),
            tool_name: self.tool_name.clone(),
            arguments: self.arguments.clone(),
            requested_by: self
                .requested_by
                .as_ref()
                .map(|user| user.as_ref().to_owned()),
            status: self.status,
            resolved_by: self
                .resolved_by
                .as_ref()
                .map(|user| user.as_ref().to_owned()),
            remembered: self.remembered,
        }
    }
}

/// The owner's "approve, and don't ask me again": one person may make the
/// calls it covers in one session without the owner being asked each time.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StandingApproval {
    /// The session it holds in, for as long as the session lasts.
    pub session: AgentSessionId,
    /// Who may make the calls.
    pub user: MacroUserIdStr<'static>,
    /// `macro`, or the connected app's slug.
    pub server_slug: String,
    /// The one tool covered on Macro's server, which reaches all of the
    /// owner's data; `None` covers a whole connected app.
    pub tool_name: Option<String>,
    /// The owner who said so.
    pub granted_by: MacroUserIdStr<'static>,
}

impl StandingApproval {
    /// What approving `approval` for good covers: the same tool on Macro,
    /// the whole app otherwise. `None` when no person asked, since there is
    /// nobody to remember.
    #[must_use]
    pub fn covering(approval: &ToolApproval, granted_by: &MacroUserIdStr<'static>) -> Option<Self> {
        Some(Self {
            session: approval.session,
            user: approval.requested_by.clone()?,
            server_slug: approval.server_slug.clone(),
            tool_name: (approval.server_slug == MACRO_SERVER_SLUG)
                .then(|| approval.tool_name.clone()),
            granted_by: granted_by.clone(),
        })
    }

    /// Whether it covers `user` calling `tool` on `server_slug` in `session`.
    #[must_use]
    pub fn covers(
        &self,
        session: AgentSessionId,
        user: &MacroUserIdStr<'static>,
        server_slug: &str,
        tool: &str,
    ) -> bool {
        self.session == session
            && self.user == *user
            && self.server_slug == server_slug
            && self
                .tool_name
                .as_deref()
                .is_none_or(|covered| covered == tool)
    }
}

/// What a person answers a held call with.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalAnswer {
    /// Let it run.
    Approve,
    /// Let it run, and let the same person make the calls it covers in this
    /// session without asking again.
    ApproveAndRemember,
    /// Refuse it.
    Deny,
    /// Give up waiting on the owner.
    Cancel,
}

impl ApprovalAnswer {
    pub(super) fn status(self) -> ToolApprovalStatus {
        match self {
            Self::Approve | Self::ApproveAndRemember => ToolApprovalStatus::Approved,
            Self::Deny => ToolApprovalStatus::Denied,
            Self::Cancel => ToolApprovalStatus::Cancelled,
        }
    }
}

/// Why an answer was refused.
#[derive(Debug, thiserror::Error)]
pub enum ToolApprovalError {
    /// No such approval in this session.
    #[error("no such tool approval")]
    NotFound,
    /// Somebody resolved it first.
    #[error("the tool approval was already resolved")]
    NotPending,
    /// Only the owner may approve or decline.
    #[error("only the session owner may approve or decline a tool call")]
    NotOwner,
    /// A call no person asked for cannot be approved for good.
    #[error("a call a bot made on nobody's behalf cannot be approved for good")]
    NobodyToRemember,
    /// The store failed.
    #[error(transparent)]
    Egress(#[from] EgressError),
}

/// The parts of a `tools/call` the hold reads.
#[derive(Clone, Debug, PartialEq)]
pub struct ToolsCall {
    /// The JSON-RPC id the answer echoes.
    pub id: serde_json::Value,
    /// The tool's name.
    pub name: String,
    /// Its arguments.
    pub arguments: serde_json::Value,
    /// The progress token the client asked to be kept alive under.
    pub progress_token: Option<serde_json::Value>,
}

impl ToolsCall {
    /// Read a `tools/call` request body; `None` for anything else.
    #[must_use]
    pub fn parse(body: &[u8]) -> Option<Self> {
        let value: serde_json::Value = serde_json::from_slice(body).ok()?;
        if value.get("method")?.as_str()? != crate::domain::model::TOOLS_CALL_METHOD {
            return None;
        }
        let id = value.get("id").filter(|id| !id.is_null())?.clone();
        let params = value.get("params")?;
        Some(Self {
            id,
            name: params.get("name")?.as_str()?.to_owned(),
            arguments: params
                .get("arguments")
                .cloned()
                .unwrap_or(serde_json::Value::Null),
            progress_token: params
                .get("_meta")
                .and_then(|meta| meta.get("progressToken"))
                .filter(|token| !token.is_null())
                .cloned(),
        })
    }
}
