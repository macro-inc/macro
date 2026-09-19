//! Optional agent-neutral lifecycle facts for reconstructed conversation turns.
use agent_client_protocol::JsonRpcNotification;
use agent_client_protocol::schema::v1::SessionId;
use serde::{Deserialize, Serialize};

/// Completes the currently projected turn without inventing a prompt response.
/// This optional extension conveys history facts; it does not certify a load,
/// change load success semantics, or imply completion when absent.
#[derive(Debug, Clone, Serialize, Deserialize, JsonRpcNotification)]
#[notification(method = "_session/turn_complete")]
#[serde(rename_all = "camelCase")]
pub struct TurnCompleteNotification {
    /// ACP session whose current projected turn ended.
    pub session_id: SessionId,
    /// The recorded terminal outcome.
    pub outcome: TurnOutcome,
}

/// Recorded terminal outcome of a reconstructed turn.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TurnOutcome {
    /// The agent completed its work.
    Finished,
    /// The turn was cancelled.
    Cancelled,
    /// The turn failed.
    Failed {
        /// Failure description supplied by the adapter.
        message: String,
    },
}
