//! Ports (trait contracts) for the reminders domain.

use chrono::{DateTime, Utc};
use entity_access::domain::models::{AnyEntityPermission, EntityAccessReceipt, OwnerAccessLevel};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use crate::domain::models::{
    CreateReminder, DeliveryOutcome, DueFiring, DueReminder, NewReminder, Reminder, ReminderBatch,
    ReminderDispatchMessage, ReminderError, ReminderFilter, ReminderForSoup, ReminderPage,
    ReminderPatch, ReminderUpdate, SoupReminderQuery, SweepSummary,
};

/// Source of the current time.
///
/// Injected so schedule boundaries — "exactly now", DST transitions, a cron
/// whose last firing has passed — can be tested deterministically instead of
/// relative to the wall clock.
pub trait Clock: Send + Sync + 'static {
    /// The current instant.
    fn now(&self) -> DateTime<Utc>;
}

/// The real clock.
#[derive(Debug, Clone, Copy, Default)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> DateTime<Utc> {
        Utc::now()
    }
}

/// Outbound persistence port for reminders.
///
/// Every method is scoped to a user: a reminder is private to its owner, so an
/// id belonging to someone else simply misses rather than erroring.
pub trait RemindersRepo: Send + Sync + 'static {
    /// The error type returned by repository operations.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Insert a reminder for the user.
    fn create_reminder(
        &self,
        user_id: &MacroUserIdStr<'_>,
        new: &NewReminder,
    ) -> impl Future<Output = Result<Reminder, Self::Err>> + Send;

    /// Fetch one of the user's reminders.
    fn get_reminder(
        &self,
        user_id: &MacroUserIdStr<'_>,
        id: Uuid,
    ) -> impl Future<Output = Result<Option<Reminder>, Self::Err>> + Send;

    /// Read at most `limit` of the user's reminders matching `filter`, ordered
    /// by `(next_run_at, created_at, id)` and resuming after `filter.cursor`.
    ///
    /// The caller asks for one more than the page size to discover whether
    /// another page exists, and must use [`ReminderBatch::examined`] — not the
    /// decoded row count — to make that judgement.
    fn list_reminders(
        &self,
        user_id: &MacroUserIdStr<'_>,
        filter: &ReminderFilter,
        limit: i64,
    ) -> impl Future<Output = Result<ReminderBatch, Self::Err>> + Send;

    /// Read at most `limit` of the user's reminders for the Soup feed, ordered
    /// by `next_run_at` in `order`'s direction.
    ///
    /// `query.order` must match the direction Soup will merge in. There is no cursor
    /// here, so it selects which `limit` reminders come back, not merely how
    /// they are arranged: an ascending view served by a descending read gets
    /// the furthest-future reminders and never sees an overdue one.
    ///
    /// Deliberately separate from [`RemindersRepo::list_reminders`]: Soup pages
    /// on its own cursor, whereas the CRUD list keysets ascending on
    /// `(next_run_at, created_at, id)`. As in [`RemindersRepo::list_reminders`],
    /// an undecodable row is skipped rather than failing the whole read.
    ///
    /// `query.fired` selects on whether `next_run_at` has come due, evaluated against
    /// the database clock so the caller need not agree with it on the time.
    ///
    /// An empty `ids`/`entities` slice means "no constraint", not "match none".
    fn list_reminders_for_soup(
        &self,
        user_id: &MacroUserIdStr<'_>,
        query: SoupReminderQuery<'_>,
    ) -> impl Future<Output = Result<Vec<ReminderForSoup>, Self::Err>> + Send;

    /// Apply `update` to one of the user's reminders, returning the new state.
    fn update_reminder(
        &self,
        user_id: &MacroUserIdStr<'_>,
        id: Uuid,
        update: &ReminderUpdate,
    ) -> impl Future<Output = Result<Option<Reminder>, Self::Err>> + Send;

    /// Delete one of the user's reminders, retracting any notification it
    /// already produced. Returns `true` when a row was removed.
    ///
    /// The retraction is part of this contract rather than a separate call so
    /// the two cannot drift apart. A reminder *is* its notification's
    /// `event_item`, so a notification outliving it would point at a row that
    /// no longer exists: the Inbox would keep showing it, and clicking it would
    /// resolve nothing. Both deletes happen in one transaction.
    fn delete_reminder(
        &self,
        user_id: &MacroUserIdStr<'_>,
        id: Uuid,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;
}

/// Outbound persistence port for firing reminders.
///
/// Deliberately separate from [`RemindersRepo`], whose every method is scoped
/// to one user. Dispatch is the only path that reads across users, and folding
/// it in would quietly retire that invariant.
pub trait ReminderDispatchRepo: Send + Sync + 'static {
    /// The error type returned by repository operations.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Every firing due at or before `now`, soonest first.
    ///
    /// Enabled, not yet completed, and not recurring. Returns identifiers
    /// rather than whole reminders because a sweep only fans these out; the
    /// row is read at delivery, by which point it may have changed.
    ///
    /// Deliberately unbounded — a sweep that silently truncated would strand
    /// whatever fell off the end until someone noticed. See the note on the
    /// implementation for where paging goes if a sweep ever grows too large
    /// to fan out inside one message.
    fn due_firings(
        &self,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<Vec<DueFiring>, Self::Err>> + Send;

    /// Resolve a fanned-out firing back into the reminder to deliver.
    ///
    /// `None` when the reminder no longer wants this firing — deleted,
    /// completed, disabled, or rescheduled since the sweep listed it. Recurring
    /// reminders are *not* filtered out here; the domain decides what to do
    /// with those so the gap stays visible.
    fn find_due_reminder(
        &self,
        firing: DueFiring,
    ) -> impl Future<Output = Result<Option<DueReminder>, Self::Err>> + Send;

    /// Claim one firing for delivery, returning whether this caller now owns it.
    ///
    /// `false` means the firing already delivered, or another dispatcher holds
    /// it. A claim taken before `retry_before` and never delivered is
    /// reclaimable, so a dispatcher that dies mid-flight does not strand the
    /// reminder forever.
    fn claim_occurrence(
        &self,
        reminder_id: Uuid,
        scheduled_for: DateTime<Utc>,
        retry_before: DateTime<Utc>,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Give up a claim that was taken but never delivered.
    ///
    /// What makes a failed delivery retryable on the queue's own schedule: the
    /// message is redelivered within the visibility timeout, and without this
    /// the retry would lose the claim race against itself until `retry_before`
    /// finally aged the claim out. A delivered firing is never released.
    fn release_occurrence(
        &self,
        reminder_id: Uuid,
        scheduled_for: DateTime<Utc>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Record the firing as delivered.
    ///
    /// Marks the occurrence, not the reminder: delivery is not completion.
    /// `completed_at` is the owner saying they are finished with a reminder,
    /// and one that has just landed in their inbox is not. The sent occurrence
    /// is what stops [`ReminderDispatchRepo::due_firings`] returning the firing
    /// again.
    fn complete_occurrence(
        &self,
        reminder_id: Uuid,
        scheduled_for: DateTime<Utc>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// A message as it came off the dispatch queue, still unparsed.
///
/// The body stays a string so the worker can ack a message it cannot parse:
/// decoding in the adapter would leave a poison message to be redelivered
/// until the redrive policy dead-lettered it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawDispatchMessage {
    /// The raw JSON body.
    pub body: String,
    /// Handle used to delete the message once it has been handled.
    pub receipt_handle: String,
}

/// Outbound port for the queue that carries dispatch work.
///
/// One port for both directions because it is one queue: a sweep publishes
/// the `Deliver` messages that the same worker pool then receives.
pub trait ReminderDispatchQueue: Send + Sync + 'static {
    /// The error type returned by queue operations.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Publish messages, batching as the transport allows.
    ///
    /// All-or-nothing per call: a partial failure is an error, and the caller
    /// is expected to let the triggering message be redelivered. Re-fanning a
    /// firing that already went out is harmless — it loses the claim race.
    fn publish_batch(
        &self,
        messages: &[ReminderDispatchMessage],
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Receive whatever is waiting, up to the adapter's configured batch size.
    fn receive_messages(
        &self,
    ) -> impl Future<Output = Result<Vec<RawDispatchMessage>, Self::Err>> + Send;

    /// Delete a message that has been handled.
    fn delete_message(
        &self,
        receipt_handle: &str,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// Outbound port for telling a reminder's owner that it fired.
///
/// Takes domain types and returns nothing, so the domain never sees how the
/// notification is built or delivered.
pub trait ReminderNotifier: Send + Sync + 'static {
    /// The error type returned by delivery attempts.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Notify the reminder's owner. Failure leaves the firing undelivered and
    /// retryable.
    fn notify(&self, due: &DueReminder) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// Inbound service port: dispatch, driven by the queue worker.
///
/// Two use cases rather than one, because they arrive as two different
/// messages: a scheduled tick fans work out, and each fanned-out message
/// delivers a single firing.
pub trait ReminderDispatch: Send + Sync + 'static {
    /// Fan out every firing that is currently due.
    fn sweep(&self) -> impl Future<Output = Result<SweepSummary, ReminderError>> + Send;

    /// Deliver one fanned-out firing.
    fn deliver(
        &self,
        firing: DueFiring,
    ) -> impl Future<Output = Result<DeliveryOutcome, ReminderError>> + Send;
}

/// Inbound service port: the reminders API used by drivers (HTTP).
pub trait RemindersService: Send + Sync + 'static {
    /// Create a reminder for the user.
    ///
    /// `entity_receipt` must be present whenever `request` names an entity, and
    /// must have been minted for that same entity and user — that is what
    /// proves the caller may attach a reminder to it. Standalone reminders need
    /// no receipt.
    fn create_reminder(
        &self,
        user_id: &MacroUserIdStr<'_>,
        request: CreateReminder,
        entity_receipt: Option<EntityAccessReceipt<AnyEntityPermission>>,
    ) -> impl Future<Output = Result<Reminder, ReminderError>> + Send;

    /// Fetch the reminder the receipt was minted for.
    ///
    /// The receipt carries both the reminder and the caller it was proven for,
    /// so there is no separate id or user to pass — and no way to reach a
    /// reminder without having proven ownership first.
    fn get_reminder(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> impl Future<Output = Result<Reminder, ReminderError>> + Send;

    /// List one page of the user's reminders, soonest firing first.
    fn list_reminders(
        &self,
        user_id: &MacroUserIdStr<'_>,
        filter: ReminderFilter,
    ) -> impl Future<Output = Result<ReminderPage, ReminderError>> + Send;

    /// List the user's reminders for the Soup feed, ordered by `order`.
    ///
    /// Soup owns pagination across every item type, so this returns a plain
    /// bounded slice rather than a [`ReminderPage`]. It does not own ordering:
    /// the bound is applied here, so `order` decides which reminders Soup gets
    /// to merge.
    ///
    /// Unlike the single-reminder methods this takes a user id rather than a
    /// receipt: Soup reads many reminders at once, so there is no one entity
    /// to have proven access to.
    fn list_reminders_for_soup(
        &self,
        user_id: &MacroUserIdStr<'_>,
        query: SoupReminderQuery<'_>,
    ) -> impl Future<Output = Result<Vec<ReminderForSoup>, ReminderError>> + Send;

    /// Modify the reminder the receipt was minted for.
    fn update_reminder(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
        patch: ReminderPatch,
    ) -> impl Future<Output = Result<Reminder, ReminderError>> + Send;

    /// Delete the reminder the receipt was minted for.
    fn delete_reminder(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> impl Future<Output = Result<(), ReminderError>> + Send;
}
