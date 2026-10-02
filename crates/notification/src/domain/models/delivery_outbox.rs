//! Durable delivery outbox models.
//!
//! ## Failure and rollout contract
//!
//! The additive migration must land before notification-service starts writing
//! outbox rows. Recovery runs at most 25 iterations per 15-second batch; each
//! iteration can attempt preparation, intent publication, and digest cleanup.
//! Saturated batches continue immediately, while drained, failed, or timed-out
//! batches wait one second. Individual claims have a 30-second lease, and
//! preparation has a 10-second inner timeout. Claim acquisition durably
//! schedules post-lease backoff, so cancellation or process loss cannot bypass
//! bounded exponential retry. A poison row therefore does not starve newer work.
//!
//! Queue publication is intentionally at-least-once: a crash after SQS accepts
//! a payload but before Postgres records completion can republish that payload.
//! Per-intent progress prevents ordinary retry from replaying completed channel
//! work, but this layer does not claim exactly-once delivery.
//!
//! Preparation serializes its active-recipient snapshot with lifecycle writes.
//! Publication filters frozen payloads against current unseen, non-deleted
//! recipients only while the exact leased intent still owns its durable row,
//! so a deleted generation cannot borrow a recreated generation's recipients.
//! A lifecycle change concurrent with the final database check and external
//! queue handoff can still race; the outbox does not claim an atomic
//! status-check-to-SQS boundary.
//!
//! Hard-deleting a notification cascades its current outbox and intents, which
//! cancels that stored delivery generation. Its generation-scoped Redis digest
//! receipt cleanup obligation survives until external cleanup succeeds. There
//! is no deletion tombstone: an outstanding ingress request with the same id
//! may create a new generation and legitimately redeliver—including duplicate
//! digest content—under the at-least-once contract; old cleanup cannot delete
//! the new generation's receipt.
//!
//! Retried legacy ingress can create a missing outbox from persisted recipients.
//! There is deliberately no historical backfill because old channel requests
//! cannot be reconstructed safely. Completed rows remain until notification
//! deletion and are not a permanent audit log.

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use serde_json::Value;
use uuid::Uuid;

use super::UserNotificationRow;

/// Token proving ownership of a leased outbox item.
///
/// Completion and release operations require the token so an expired worker
/// cannot overwrite the progress of a newer claimant.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DeliveryClaimToken(Uuid);

impl DeliveryClaimToken {
    /// Allocate a time-sortable claim token.
    pub fn new() -> Self {
        Self(macro_uuid::generate_uuid_v7())
    }

    /// Construct a claim token read from durable storage.
    pub fn from_uuid(value: Uuid) -> Self {
        Self(value)
    }

    /// Return the stored UUID representation.
    pub fn into_uuid(self) -> Uuid {
        self.0
    }
}

impl Default for DeliveryClaimToken {
    fn default() -> Self {
        Self::new()
    }
}

/// A durable notification delivery request leased for channel preparation.
#[derive(Debug)]
pub struct ClaimedDeliveryRequest {
    /// Notification/outbox aggregate identity.
    pub notification_id: Uuid,
    /// Identity of this durable outbox generation.
    pub generation: Uuid,
    /// Lease ownership token.
    pub claim_token: DeliveryClaimToken,
    /// Original filtered, type-erased notification request.
    pub request: Value,
    /// Persisted recipient rows used by the digest decision state machine.
    pub notifications: Vec<UserNotificationRow<Value>>,
    /// Number of times preparation has been claimed, including this attempt.
    pub attempt_count: i32,
    /// Age of the durable request when claimed.
    pub pending_since: DateTime<Utc>,
}

/// A concrete channel payload leased for publication to the delivery queue.
#[derive(Debug)]
pub struct ClaimedDeliveryIntent {
    /// Notification/outbox aggregate identity.
    pub notification_id: Uuid,
    /// Stable position within the notification's prepared channel payloads.
    pub position: i32,
    /// Lease ownership token.
    pub claim_token: DeliveryClaimToken,
    /// Serialized delivery queue message.
    pub payload: Value,
    /// Number of times publication has been claimed, including this attempt.
    pub attempt_count: i32,
    /// Age of the durable channel intent when claimed.
    pub pending_since: DateTime<Utc>,
}

/// A durable request to remove one external digest idempotency receipt.
#[derive(Debug)]
pub struct ClaimedDigestReceiptCleanup {
    /// Notification id included in the Redis receipt key.
    pub notification_id: Uuid,
    /// Outbox generation whose Redis receipt may be removed.
    pub generation: Uuid,
    /// Recipient id included in the Redis receipt key.
    pub user_id: MacroUserIdStr<'static>,
    /// Lease ownership token.
    pub claim_token: DeliveryClaimToken,
    /// Number of cleanup attempts, including this attempt.
    pub attempt_count: i32,
    /// Age of the cleanup obligation when claimed.
    pub pending_since: DateTime<Utc>,
}

/// Lease timing supplied to the persistence port.
#[derive(Debug, Clone, Copy)]
pub struct DeliveryLease {
    /// Claim expiry according to the service clock.
    pub expires_at: DateTime<Utc>,
}

impl DeliveryLease {
    /// Create a lease that expires at `expires_at`.
    pub fn until(expires_at: DateTime<Utc>) -> Self {
        Self { expires_at }
    }
}
