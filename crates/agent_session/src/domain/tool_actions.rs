//! Curated session actions; the harness domain services enforce lifecycle and sharing policy.

use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use std::pin::Pin;
use uuid::Uuid;

/// Session lifecycle actions available to agents. Human approvals are deliberately absent.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum SessionAction {
    /// Rename a session you own.
    Rename {
        /// New display name.
        name: String,
    },
    /// Archive or unarchive a session you own. Active private conversations cannot be archived.
    Archive {
        /// Whether the session should be archived.
        archived: bool,
    },
    /// Delete a session you own and release its runtime resources.
    Delete,
    /// Send a follow-up prompt. Returns acceptance, not the agent's completed work.
    Prompt {
        /// Self-contained message to the agent.
        prompt: String,
    },
    /// Stop the current turn without deleting the session.
    Stop,
}

/// Delivery state of an accepted control.
#[derive(Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum SessionControlStatus {
    /// Forwarded to the running agent.
    Sent,
    /// Saved until the agent can receive it.
    Queued,
}

/// A safely attributable action result.
#[derive(Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase")]
pub struct SessionActionResult {
    /// Session acted on.
    pub session_id: Uuid,
    /// Human-readable outcome.
    pub message: String,
    /// Accepted prompt or stop id, when applicable.
    pub action_id: Option<Uuid>,
    /// Whether a control was sent or queued.
    pub status: Option<SessionControlStatus>,
}

/// Safe failure text; transport failures never imply that a mutation did not happen.
#[derive(Debug, thiserror::Error)]
pub enum SessionActionError {
    /// Missing or insufficient access.
    #[error("Session unavailable or you do not have permission for this action.")]
    Forbidden,
    /// Domain refused the command.
    #[error(
        "Session action was refused. Check the session state, ownership, and sharing settings; archived sessions cannot be prompted or renamed."
    )]
    Rejected,
    /// Delivery or response is uncertain.
    #[error(
        "Session action could not be confirmed. Read the session before retrying; do not automatically resend a prompt."
    )]
    Unconfirmed,
}

/// Session mutations routed to the service that owns the runtime.
pub trait SessionActions: Send + Sync + 'static {
    /// Execute with the verified tool caller's identity, never an AI-supplied user id.
    fn execute(
        &self,
        user: MacroUserIdStr<'static>,
        session_id: Uuid,
        action: SessionAction,
    ) -> Pin<Box<dyn Future<Output = Result<SessionActionResult, SessionActionError>> + Send + '_>>;
}
