#![deny(missing_docs)]
//! Shared message types for the ai projection queue.

use serde::{Deserialize, Serialize};

/// Message enqueued onto `ai_projection_queue` to request async materialization
/// of a per-target projection instance.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiProjectionQueueMessage {
    /// The id of the projection definition to materialize.
    pub ai_projection_id: String,
    /// The target (user id or team id) whose instance should be materialized.
    pub target_id: String,
    /// The prompt hash of the instance to materialize, used to detect staleness.
    pub prompt_hash: String,
}
