//! What the inbox needs from storage, from Stripe, and from its consumers.

use chrono::{DateTime, Utc};
use stripe::{CustomerId, EventId, SubscriptionId};
use uuid::Uuid;

use super::audit::Mismatch;
use super::model::{
    ApplyError, ClaimedCursor, Consumer, DeadCause, Delivery, ObjectSnapshot, OrderingKey,
    Position, ReceivedEvent, StoredEvent, SubscriptionFacts,
};

/// A consumer's cursor to mark due when an event arrives.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CursorWake {
    /// The consumer.
    pub consumer: Consumer,
    /// When the cursor becomes due.
    pub due_at: DateTime<Utc>,
}

/// Whether the event was new.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Inserted {
    /// Stored, cursors marked due, workers woken.
    New,
    /// Already stored; nothing changed.
    Duplicate,
}

/// A failed attempt to record on a cursor.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CursorFailure {
    /// Failed attempts so far, this one included.
    pub attempts: u32,
    /// When to try again.
    pub next_attempt_at: DateTime<Utc>,
    /// The error, for operators.
    pub error: String,
    /// Set when the cursor is dead-lettered on this event.
    pub dead: Option<DeadLetter>,
}

/// The event a cursor is dead-lettered on, and why.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeadLetter {
    /// The event that failed.
    pub event: EventId,
    /// Why it is dead.
    pub cause: DeadCause,
}

/// What a replay request did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Replayed {
    /// The cursor is due again.
    Rearmed,
    /// There is no such cursor.
    NotFound,
    /// A worker is applying the cursor's events; try again once it is done.
    Leased,
}

/// The inbox tables.
pub trait InboxRepo: Clone + Send + Sync + 'static {
    /// The storage error.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Stores `event` unless already stored; when new, also projects its
    /// snapshot (only if newer), marks `wakes` due (re-arming a cursor whose
    /// retries ran out) and wakes the workers, all in one transaction. An
    /// event created before a cursor's position moves it back to just
    /// before the event, unless it was created before `rewind_after`.
    fn insert(
        &self,
        event: &ReceivedEvent,
        wakes: &[CursorWake],
        traceparent: Option<&str>,
        rewind_after: DateTime<Utc>,
    ) -> impl Future<Output = Result<Inserted, Self::Err>> + Send;

    /// Leases up to `limit` due cursors for `lease`.
    fn claim(
        &self,
        replica: Uuid,
        limit: u32,
        lease: chrono::Duration,
    ) -> impl Future<Output = Result<Vec<ClaimedCursor>, Self::Err>> + Send;

    /// The key's next events of the consumer's types after `after`, in order.
    fn pending_events(
        &self,
        consumer: Consumer,
        key: &OrderingKey,
        after: Option<&Position>,
        limit: u32,
    ) -> impl Future<Output = Result<Vec<StoredEvent>, Self::Err>> + Send;

    /// Whether a paid outcome of `invoice_id` sorts before `before`.
    fn invoice_paid_before(
        &self,
        invoice_id: &str,
        before: &Position,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Whether a snapshot event of `object_id` sorting after `after` has
    /// been received.
    fn newer_snapshot_received(
        &self,
        object_id: &str,
        after: &Position,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Moves the cursor from `cursor.applied` past `to` and extends the
    /// lease. `false` when the lease was lost, or a late event moved the
    /// cursor back meanwhile.
    fn advance(
        &self,
        cursor: &ClaimedCursor,
        replica: Uuid,
        to: &Position,
        lease: chrono::Duration,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Records a failure and releases the lease.
    fn fail(
        &self,
        cursor: &ClaimedCursor,
        replica: Uuid,
        failure: &CursorFailure,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Releases the lease: idle when no event arrived during it, due again
    /// otherwise.
    fn release(
        &self,
        cursor: &ClaimedCursor,
        replica: Uuid,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// The newest snapshot held of a subscription.
    fn subscription_snapshot(
        &self,
        id: &SubscriptionId,
    ) -> impl Future<Output = Result<Option<serde_json::Value>, Self::Err>> + Send;

    /// Every subscription snapshot of `customer`, or `None` when its
    /// subscriptions were never listed from Stripe (so the projection may
    /// lack ones created before the inbox).
    fn customer_subscriptions(
        &self,
        customer: &CustomerId,
    ) -> impl Future<Output = Result<Option<Vec<serde_json::Value>>, Self::Err>> + Send;

    /// The customer's snapshot and whether Stripe deleted it.
    fn customer_snapshot(
        &self,
        customer: &CustomerId,
    ) -> impl Future<Output = Result<Option<(serde_json::Value, bool)>, Self::Err>> + Send;

    /// Stores snapshots read from the API at `observed_at`, each only if
    /// newer than the one held. With `listed`, also records that every
    /// subscription of that customer is now held.
    fn store_read(
        &self,
        snapshots: &[ObjectSnapshot],
        observed_at: DateTime<Utc>,
        listed: Option<&CustomerId>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Makes a cursor due again; with `skip_dead_event`, past the event that
    /// dead-lettered it.
    fn replay(
        &self,
        consumer: Consumer,
        key: &OrderingKey,
        skip_dead_event: bool,
    ) -> impl Future<Output = Result<Replayed, Self::Err>> + Send;

    /// Makes up to `limit` dead cursors (of `consumer`, or of every one) due
    /// again, as [`Self::replay`] does; returns how many.
    fn replay_dead(
        &self,
        consumer: Option<Consumer>,
        skip_dead_event: bool,
        limit: u32,
    ) -> impl Future<Output = Result<u64, Self::Err>> + Send;
}

/// One page of a Stripe list.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Page {
    /// The objects, as JSON.
    pub data: Vec<serde_json::Value>,
    /// Whether another page follows.
    pub has_more: bool,
}

/// Why a Stripe read failed.
#[derive(Debug, thiserror::Error)]
pub enum StripeReadError {
    /// Stripe answered 429.
    #[error("stripe rate limited the read")]
    RateLimited,
    /// Any other failure.
    #[error("stripe read failed: {0}")]
    Failed(rootcause::Report),
}

/// The few Stripe reads the inbox makes: settling ambiguity, filling a
/// missing snapshot, and the audit. Implementations pace their calls.
pub trait StripeReader: Send + Sync + 'static {
    /// One subscription.
    fn retrieve_subscription(
        &self,
        id: &SubscriptionId,
    ) -> impl Future<Output = Result<serde_json::Value, StripeReadError>> + Send;

    /// Every item of a subscription, paged.
    fn subscription_items(
        &self,
        id: &SubscriptionId,
    ) -> impl Future<Output = Result<Vec<serde_json::Value>, StripeReadError>> + Send;

    /// Every subscription of a customer, any status, paged.
    fn customer_subscriptions(
        &self,
        customer: &CustomerId,
    ) -> impl Future<Output = Result<Vec<serde_json::Value>, StripeReadError>> + Send;

    /// One customer.
    fn retrieve_customer(
        &self,
        customer: &CustomerId,
    ) -> impl Future<Output = Result<serde_json::Value, StripeReadError>> + Send;

    /// A page of events created at or after `since`, newest first.
    fn events(
        &self,
        since: DateTime<Utc>,
        starting_after: Option<&EventId>,
    ) -> impl Future<Output = Result<Page, StripeReadError>> + Send;

    /// A page of all subscriptions, any status.
    fn subscriptions(
        &self,
        starting_after: Option<&SubscriptionId>,
    ) -> impl Future<Output = Result<Page, StripeReadError>> + Send;
}

/// The domains that act on events. One implementation dispatches to all of
/// them; each consumer must be safe to apply again (its cursor advances
/// after it succeeds).
pub trait EventConsumers: Send + Sync + 'static {
    /// Applies one event for `consumer`.
    fn apply(
        &self,
        consumer: Consumer,
        delivery: &Delivery,
    ) -> impl Future<Output = Result<(), ApplyError>> + Send;
}

/// The audit's storage.
pub trait AuditRepo: Clone + Send + Sync + 'static {
    /// The storage error.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Starts a run when none ran in the last `interval` and none is in
    /// progress; returns its id.
    fn claim_run(
        &self,
        replica: Uuid,
        interval: chrono::Duration,
        lease: chrono::Duration,
    ) -> impl Future<Output = Result<Option<Uuid>, Self::Err>> + Send;

    /// Ends the run.
    fn finish_run(&self, replica: Uuid) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Which of `ids` are stored.
    fn stored_event_ids(
        &self,
        ids: &[EventId],
    ) -> impl Future<Output = Result<Vec<EventId>, Self::Err>> + Send;

    /// The distinct event types received since `since`.
    fn received_types(
        &self,
        since: DateTime<Utc>,
    ) -> impl Future<Output = Result<Vec<String>, Self::Err>> + Send;

    /// The snapshots held of `ids`, with when each was observed.
    fn subscription_snapshots(
        &self,
        ids: &[SubscriptionId],
    ) -> impl Future<Output = Result<Vec<(serde_json::Value, DateTime<Utc>)>, Self::Err>> + Send;

    /// Whether the customer's latest invoice outcome held is a failed
    /// payment (which revokes access while Stripe may still show the
    /// subscription live).
    fn last_invoice_failed(
        &self,
        customer: &CustomerId,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// How many cursors of each consumer are dead-lettered.
    fn dead_cursors(&self) -> impl Future<Output = Result<Vec<(Consumer, u64)>, Self::Err>> + Send;

    /// Records a run's findings.
    fn record(
        &self,
        run_id: Uuid,
        mismatches: &[Mismatch],
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Clears payloads older than `clear_before` and deletes events and
    /// findings older than `delete_before`.
    fn apply_retention(
        &self,
        clear_before: DateTime<Utc>,
        delete_before: DateTime<Utc>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// Compares one Stripe subscription with the owning domains' state.
pub trait DomainAudit: Send + Sync + 'static {
    /// The mismatches found; never changes anything. A domain that cannot
    /// be read yields a [`MismatchKind::Unchecked`](super::audit::MismatchKind::Unchecked)
    /// finding, not an error, so one unreadable account never stops the
    /// sweep. `last_invoice_failed`: the customer's latest invoice payment
    /// failed, so access is revoked while the subscription may still be
    /// live.
    fn check(
        &self,
        subscription: &SubscriptionFacts,
        last_invoice_failed: bool,
    ) -> impl Future<Output = Result<Vec<Mismatch>, rootcause::Report>> + Send;
}
