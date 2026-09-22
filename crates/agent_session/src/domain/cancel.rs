//! Conditional interruption of one identified agent turn.

use agent_runtime_protocol::domain::action::AgentActionId;
use serde::{Deserialize, Serialize};

/// A correction reserved to run immediately after the interrupted turn.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct TurnReplacement {
    /// Client-minted identity of the replacement prompt. This may also be the
    /// cancellation's request ID: ACP cancellation is an unnumbered notification.
    pub action_id: AgentActionId,
    /// The corrected instruction.
    pub prompt: String,
}

/// Cancel only the named currently running action, optionally replacing it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct CancelTurn {
    /// Identity of this operation. Retries must keep its entire payload.
    pub request_id: AgentActionId,
    /// The action that must still own the running turn.
    pub expected_action_id: AgentActionId,
    /// Work reserved ahead of ordinary queued prompts after cancellation.
    pub replacement: Option<TurnReplacement>,
}

/// Successful conditional cancellation, not a claim that work has finished.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum CancelTurnOutcome {
    /// Cancellation reached the matching runtime turn.
    Stopping,
    /// Cancellation reached the turn and its correction is reserved next.
    Replaced {
        /// The correction's action ID, used to correlate the resulting turn.
        #[serde(rename = "replacementActionId")]
        replacement_action_id: AgentActionId,
    },
}
