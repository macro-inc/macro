//! Sequence steps: the scheduled sends the `email_sequences` crate creates,
//! watches and withdraws. Every method runs on the caller's connection, so a
//! sequence can create or cancel a step inside the transaction that holds its
//! enrollment's lock. Nothing here waits on a sequence lock.

use chrono::{DateTime, Utc};
use uuid::Uuid;

use super::models::{ContactInfo, ScheduledSendStatus, UpsertedContacts, UserProvider};

/// An inbox a sequence may send from, as the sweep checks it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SendingInbox {
    /// The inbox.
    pub link_id: Uuid,
    /// The Macro user who connected it (not a delegate).
    pub macro_id: String,
    /// Its address, the sender of every step.
    pub email_address: String,
    /// Gmail or Outlook.
    pub provider: UserProvider,
    /// Connected, syncing, not being deleted, and not waiting for reauthorization.
    pub healthy: bool,
}

/// A step to schedule.
#[derive(Debug, Clone)]
pub struct NewStep<'a> {
    /// Sending inbox.
    pub link_id: Uuid,
    /// The owner, recorded as the schedule's actor.
    pub actor: &'a str,
    /// Sender and recipient contacts, upserted before the caller's transaction.
    pub contacts: &'a UpsertedContacts,
    /// The one recipient.
    pub to: &'a ContactInfo,
    /// Subject line, one line.
    pub subject: &'a str,
    /// Plain-text body.
    pub body_text: &'a str,
    /// The sent message this step replies to, in the same inbox.
    pub reply_to: Option<Uuid>,
    /// When to send; must be in the future.
    pub send_time: DateTime<Utc>,
    /// One-click unsubscribe URL for the `List-Unsubscribe` header.
    pub list_unsubscribe_url: &'a str,
}

/// What the caller saw before cancelling, so a step that moved in between is
/// left alone.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CancelExpectation {
    /// Withdraw it only while it is still scheduled.
    Scheduled,
    /// Withdraw it whatever it is, unless sent or in delivery.
    Any,
}

/// What cancelling a step did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CancelOutcome {
    /// The schedule and its draft are gone.
    Cancelled,
    /// It no longer matched the expectation; nothing changed.
    Changed,
    /// Delivery started or its outcome is uncertain; it can't be withdrawn.
    DeliveryStarted,
    /// It was already sent.
    Sent,
    /// The message no longer exists.
    Gone,
}

/// Where a step's email is.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StepState {
    /// The message no longer exists; it may have been sent.
    Gone,
    /// Sent.
    Sent {
        /// When the inbox records it as sent.
        sent_at: DateTime<Utc>,
        /// When delivery handed it to the provider; replies can only follow this.
        submitted_at: Option<DateTime<Utc>>,
        /// Message-ID minted for the send.
        delivery_message_id: Option<String>,
        /// Message-ID of the synced sent copy.
        global_id: Option<String>,
    },
    /// Still scheduled.
    Scheduled {
        /// When it is due.
        send_time: DateTime<Utc>,
        /// Delivery state.
        status: ScheduledSendStatus,
    },
    /// An unsent draft with no schedule: removed from the schedule outside
    /// the sequence.
    Unscheduled {
        /// In Trash, or deleted at the provider.
        discarded: bool,
    },
}

/// An incoming message, as a sequence reads it to find replies and bounces.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InboundMessage {
    /// Local message id.
    pub id: Uuid,
    /// When the inbox received it.
    pub received_at: Option<DateTime<Utc>>,
    /// Sender address, lowercased.
    pub from: Option<String>,
    /// The stored message it replies to.
    pub replying_to_id: Option<Uuid>,
    /// Its headers, as `(name, value)` in stored order.
    pub headers: Vec<(String, String)>,
    /// Plain-text body, read only for a single message.
    pub body_text: Option<String>,
}

/// Messages to read when checking an enrollment for answers.
#[derive(Debug, Clone, Copy)]
pub struct ReplySearch<'a> {
    /// The enrollment's inbox.
    pub link_id: Uuid,
    /// The enrolled address, lowercased.
    pub email: &'a str,
    /// The step messages sent so far.
    pub step_message_ids: &'a [Uuid],
    /// Only messages received after this.
    pub since: DateTime<Utc>,
}

/// An unsent sequence schedule.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PendingStep {
    /// Inbox.
    pub link_id: Uuid,
    /// Draft message.
    pub message_id: Uuid,
}

/// Persistence for sequence steps, on a connection the caller owns.
pub trait SequenceStepStore: Send + Sync + 'static {
    /// The connection type every method runs on.
    type Conn: Send;
    /// Adapter error.
    type Err: std::error::Error + Send + Sync + 'static;

    /// The inbox, if it exists.
    fn sending_inbox(
        &self,
        conn: &mut Self::Conn,
        link_id: Uuid,
    ) -> impl Future<Output = Result<Option<SendingInbox>, Self::Err>> + Send;

    /// Upsert the sender and recipient contacts. Run outside any transaction
    /// that locks messages: contacts are shared across messages.
    fn upsert_contacts(
        &self,
        conn: &mut Self::Conn,
        link_id: Uuid,
        from: &ContactInfo,
        to: &ContactInfo,
    ) -> impl Future<Output = Result<UpsertedContacts, Self::Err>> + Send;

    /// Create the step's draft and its schedule (`source = 'sequence'`).
    /// Returns the draft's message id.
    fn create_step(
        &self,
        conn: &mut Self::Conn,
        step: &NewStep<'_>,
    ) -> impl Future<Output = Result<Uuid, Self::Err>> + Send;

    /// Withdraw an unsent step: delete its schedule and its draft.
    fn cancel_step(
        &self,
        conn: &mut Self::Conn,
        message_id: Uuid,
        expect: CancelExpectation,
    ) -> impl Future<Output = Result<CancelOutcome, Self::Err>> + Send;

    /// Whether the message is a sent message in the inbox.
    fn is_sent_in(
        &self,
        conn: &mut Self::Conn,
        link_id: Uuid,
        message_id: Uuid,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Where the step's email is.
    fn step_state(
        &self,
        conn: &mut Self::Conn,
        message_id: Uuid,
    ) -> impl Future<Output = Result<StepState, Self::Err>> + Send;

    /// Take the inbox's sequence send-slot lock for the rest of the
    /// transaction and return its latest unsent sequence send time.
    fn lock_send_slot(
        &self,
        conn: &mut Self::Conn,
        link_id: Uuid,
    ) -> impl Future<Output = Result<Option<DateTime<Utc>>, Self::Err>> + Send;

    /// An incoming message: `None` if missing, sent, or a draft.
    fn inbound_message(
        &self,
        conn: &mut Self::Conn,
        link_id: Uuid,
        message_id: Uuid,
    ) -> impl Future<Output = Result<Option<InboundMessage>, Self::Err>> + Send;

    /// Local messages in the inbox whose Message-ID, or whose minted
    /// delivery Message-ID, is one of `references`.
    fn resolve_references(
        &self,
        conn: &mut Self::Conn,
        link_id: Uuid,
        references: &[String],
    ) -> impl Future<Output = Result<Vec<Uuid>, Self::Err>> + Send;

    /// Incoming messages after `since` that may answer the steps: from the
    /// enrolled address, replying to a step, or in a step's current thread.
    fn replies_since(
        &self,
        conn: &mut Self::Conn,
        search: ReplySearch<'_>,
    ) -> impl Future<Output = Result<Vec<InboundMessage>, Self::Err>> + Send;

    /// Unsent sequence schedules that can still be withdrawn, after `after`
    /// in message id order.
    fn pending_steps(
        &self,
        conn: &mut Self::Conn,
        after: Option<Uuid>,
        limit: i64,
    ) -> impl Future<Output = Result<Vec<PendingStep>, Self::Err>> + Send;
}
