//! Ports (trait contracts) for the reminders domain.

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use crate::domain::models::{
    DeliveryOutcome, DueFiring, DueReminder, ReminderDispatchMessage, ReminderError, SweepSummary,
};

/// Source of the current time.
///
/// Injected so schedule boundaries and retries can be tested deterministically.
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

    /// Read private active email snoozes with keyset pagination.
    /// `thread_ids` optionally restricts candidates; None discovers the collection.
    fn email_candidates(
        &self,
        user: &MacroUserIdStr<'_>,
        thread_ids: Option<&[Uuid]>,
        cursor: Option<super::email_collection::EmailReminderCursor>,
        as_of: DateTime<Utc>,
        limit: u32,
    ) -> impl Future<
        Output = Result<Vec<super::email_collection::EmailReminderCandidate>, Self::Err>,
    > + Send;
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
    /// Returns undelivered snooze identifiers for fan-out. Delivery reads the
    /// current workflow again because it may have changed since the sweep.
    fn due_firings(
        &self,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<Vec<DueFiring>, Self::Err>> + Send;

    /// Resolve a fanned-out firing back into the reminder to deliver.
    ///
    /// `None` when the reminder no longer wants this firing — deleted,
    /// completed, disabled, or rescheduled since the sweep listed it.
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

    /// Record successful delivery so duplicate queue messages cannot notify again.
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
    /// List original email identities with the caller's active snoozes.
    fn list_email_reminders(
        &self,
        viewer: super::email_collection::EmailReminderViewer,
        query: super::email_collection::EmailReminderQuery,
    ) -> impl Future<Output = Result<super::email_collection::EmailReminderPage, ReminderError>> + Send;

    /// Read the most recent snooze on this caller's thread.
    fn get_email_followup(
        &self,
        user: MacroUserIdStr<'static>,
        thread: Uuid,
    ) -> impl Future<Output = Result<Option<super::email_followup::EmailFollowup>, ReminderError>> + Send;

    /// Execute an idempotent email snooze command.
    fn execute_email_followup(
        &self,
        user: MacroUserIdStr<'static>,
        thread: Uuid,
        command: super::email_followup::EmailFollowupCommand,
    ) -> impl Future<Output = Result<super::email_followup::EmailFollowup, ReminderError>> + Send;
}
