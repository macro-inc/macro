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

/// Transactionally replaces earlier conversation history while retaining a
/// currently pending prompt after it. Optional projection traffic, independent
/// of standard ACP load success and its request/response contract.
#[derive(Debug, Clone, Serialize, Deserialize, JsonRpcNotification)]
#[notification(method = "_session/history_snapshot")]
#[serde(rename_all = "camelCase")]
pub struct HistorySnapshotNotification {
    /// The ACP session being reconstructed.
    pub session_id: SessionId,
    /// Correlation token unique to the ordered snapshot attempt.
    pub snapshot_id: String,
    /// Whether the snapshot is starting or committing.
    pub phase: HistorySnapshotPhase,
}

/// The boundaries of an optional history replacement transaction.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HistorySnapshotPhase {
    /// Stage subsequent history facts without changing the visible conversation.
    Begin,
    /// Replace history and restore any still-pending local request after it.
    Commit,
}
