//! Durable optimistic-mutation queue models.
//!
//! The cache engine owns mutation ordering and optimistic composition; storage
//! backends persist these transport-neutral values atomically. Authentication
//! credentials and urql operation context are deliberately excluded: replay
//! reconstructs an operation using the current client configuration.

use crate::normalize::RecordUpdates;
use serde::{Deserialize, Serialize};

/// Durable, monotonically increasing mutation identifier and queue position.
pub type MutationId = u64;

/// The serializable portion of a GraphQL mutation needed for replay.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MutationRequest {
    /// GraphQL mutation document text.
    pub query: String,
    /// Selected operation when the document contains named operations.
    pub operation_name: Option<String>,
    /// Canonical JSON object containing the mutation variables.
    pub variables_json: String,
    /// Opaque identity witness bound when the mutation was enqueued.
    pub identity: Option<String>,
}

/// Persisted retry and lease state for one queued mutation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StoredMutation {
    /// Replayable GraphQL request.
    pub request: MutationRequest,
    /// Number of times this mutation has been claimed for a network attempt.
    pub attempt_count: u32,
    /// Earliest wall-clock time at which the head may be claimed again.
    pub next_attempt_at_ms: Option<i64>,
    /// Owner of the current claim, if any.
    pub lease_owner: Option<String>,
    /// Monotonic generation used to reject stale attempt results.
    pub lease_generation: u64,
    /// Time at which the current claim becomes available to another owner.
    pub lease_expires_at_ms: Option<i64>,
    /// Last retryable network error, for diagnostics.
    pub last_error: Option<String>,
    /// Wall-clock enqueue time, for diagnostics.
    pub created_at_ms: i64,
}

impl StoredMutation {
    /// Creates an unclaimed queue row for `request`.
    pub fn new(request: MutationRequest, created_at_ms: i64) -> Self {
        Self {
            request,
            attempt_count: 0,
            next_attempt_at_ms: None,
            lease_owner: None,
            lease_generation: 0,
            lease_expires_at_ms: None,
            last_error: None,
            created_at_ms,
        }
    }
}

/// One durable optimistic layer paired one-to-one with a queued mutation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PersistedOptimisticLayer {
    /// Canonical JSON optimistic response, retained for re-normalization after
    /// a record-schema change.
    pub optimistic_data_json: String,
    /// Normalized contribution used to hydrate the effective cache view.
    pub normalized_updates: RecordUpdates,
}

/// A mutation and optimistic layer before storage assigns its queue id.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct NewQueuedMutation {
    /// Mutation request plus initial retry metadata.
    pub mutation: StoredMutation,
    /// Optimistic contribution paired with the mutation.
    pub optimistic: PersistedOptimisticLayer,
}

/// One complete durable queue entry.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct QueuedMutation {
    /// Durable queue id and ordering key.
    pub id: MutationId,
    /// Mutation request and retry metadata.
    pub mutation: StoredMutation,
    /// Optimistic contribution paired with the mutation.
    pub optimistic: PersistedOptimisticLayer,
}

/// Successful claim of the oldest runnable mutation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ClaimedMutation {
    /// Claimed queue entry, including updated attempt and lease metadata.
    pub queued: QueuedMutation,
    /// Generation that settlement calls must present.
    pub lease_generation: u64,
}

/// Parameters for claiming the strict queue head.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MutationClaimRequest {
    /// Stable owner id for one queue runner.
    pub owner: String,
    /// Current wall-clock time.
    pub now_ms: i64,
    /// Absolute expiration time for the new lease.
    pub lease_expires_at_ms: i64,
}

/// Identifies the attempt allowed to settle or defer a mutation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MutationClaimToken {
    /// Stable owner id supplied at claim time.
    pub owner: String,
    /// Lease generation returned by the successful claim.
    pub generation: u64,
}
