//! Ports the sequences domain drives.

use chrono::{DateTime, Utc};
use uuid::Uuid;

use super::models::{
    ContactEnrollment, CrmPerson, EnrollResult, EnrollmentAction, EnrollmentDetail, EnrollmentRow,
    EnrollmentSummary, HistoryRow, Owner, Sequence, SequenceError, SequenceSummary, Step,
    UnsubscribeToken,
};
use super::service::{EnrollRequest, SequencePatch};

/// A new sequence.
#[derive(Debug, Clone, serde::Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema), schema(as = SequenceInput))]
#[serde(rename_all = "camelCase")]
pub struct NewSequence {
    /// Display name.
    pub name: String,
    /// Sending inbox.
    pub link_id: Option<Uuid>,
    /// Footer line.
    #[serde(default)]
    pub footer: String,
    /// Step templates.
    #[serde(default)]
    pub steps: Vec<Step>,
}

/// A new enrollment, rendered.
#[derive(Debug, Clone)]
pub struct NewEnrollment<'a> {
    /// Its sequence.
    pub sequence_id: Uuid,
    /// The team.
    pub team_id: Uuid,
    /// Sending inbox, frozen at enrollment.
    pub link_id: Option<Uuid>,
    /// The CRM person.
    pub crm_contact_id: Uuid,
    /// Normalized address.
    pub email: &'a str,
    /// Display name.
    pub contact_name: Option<&'a str>,
    /// Rendered steps.
    pub steps: &'a [Step],
    /// When the first step is due.
    pub due_at: DateTime<Utc>,
    /// IANA time zone.
    pub timezone: &'a str,
    /// Local send time.
    pub send_time: chrono::NaiveTime,
}

/// A recipient's unsubscribe state.
#[derive(Debug, Clone)]
pub struct RecipientState {
    /// The token in its links.
    pub token: UnsubscribeToken,
    /// Whether it unsubscribed.
    pub unsubscribed: bool,
}

/// An enrollment due for its next step.
#[derive(Debug, Clone)]
pub struct DueEnrollment {
    /// Enrollment id.
    pub id: Uuid,
    /// When it came due.
    pub due_at: DateTime<Utc>,
    /// Its inbox.
    pub link_id: Option<Uuid>,
    /// Enrolled address.
    pub email: String,
    /// Name at enrollment.
    pub contact_name: Option<String>,
}

/// What a sent step recorded.
#[derive(Debug, Clone)]
pub struct SentStep {
    /// When it was sent.
    pub sent_at: DateTime<Utc>,
    /// Minted Message-ID.
    pub delivery_message_id: Option<String>,
    /// Synced Message-ID, without angle brackets.
    pub provider_message_id: Option<String>,
}

/// A match the reply hook should check.
#[derive(Debug, Clone, Copy)]
pub struct ReplyCandidates<'a> {
    /// The inbox the message arrived in.
    pub link_id: Uuid,
    /// Sender address.
    pub from: Option<&'a str>,
    /// Addresses a bounce names.
    pub failed_recipients: &'a [String],
    /// Message-IDs it references, without angle brackets.
    pub references: &'a [String],
    /// Local messages those references (or its In-Reply-To) resolve to.
    pub message_ids: &'a [Uuid],
    /// A bounce's text, lowercased, to find addresses in.
    pub bounce_text: Option<&'a str>,
}

/// Sequences persistence. Writes that must hold an enrollment's lock run in a
/// [`SequenceRepo::Tx`]; the email step port runs on its connection. Dropping
/// a transaction without committing rolls it back.
pub trait SequenceRepo: Send + Sync + 'static {
    /// Adapter error.
    type Err: std::error::Error + Send + Sync + 'static;
    /// An open transaction.
    type Tx: Send;
    /// The connection a transaction runs on.
    type Conn: Send;

    /// The connection under a transaction.
    fn conn(tx: &mut Self::Tx) -> &mut Self::Conn;

    /// Open a transaction.
    fn begin(&self) -> impl Future<Output = Result<Self::Tx, Self::Err>> + Send;
    /// Commit it.
    fn commit(&self, tx: Self::Tx) -> impl Future<Output = Result<(), Self::Err>> + Send;

    // Sequences.

    /// The owner's sequences with enrollment counts.
    fn list_sequences(
        &self,
        owner: &Owner,
    ) -> impl Future<Output = Result<Vec<SequenceSummary>, Self::Err>> + Send;
    /// One of the owner's sequences.
    fn sequence(
        &self,
        owner: &Owner,
        id: Uuid,
    ) -> impl Future<Output = Result<Option<Sequence>, Self::Err>> + Send;
    /// A sequence's enrollments.
    fn enrollments(
        &self,
        sequence_id: Uuid,
    ) -> impl Future<Output = Result<Vec<EnrollmentSummary>, Self::Err>> + Send;
    /// Insert a draft sequence.
    fn insert_sequence(
        &self,
        owner: &Owner,
        input: &NewSequence,
    ) -> impl Future<Output = Result<Sequence, Self::Err>> + Send;
    /// Lock one of the owner's sequences: `FOR UPDATE`, or `FOR SHARE` when
    /// `share`.
    fn lock_sequence(
        &self,
        tx: &mut Self::Tx,
        owner: &Owner,
        id: Uuid,
        share: bool,
    ) -> impl Future<Output = Result<Option<Sequence>, Self::Err>> + Send;
    /// Write a sequence's fields and status, bumping its version.
    fn save_sequence(
        &self,
        tx: &mut Self::Tx,
        sequence: &Sequence,
    ) -> impl Future<Output = Result<Sequence, Self::Err>> + Send;
    /// Delete a sequence.
    fn delete_sequence(
        &self,
        tx: &mut Self::Tx,
        id: Uuid,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
    /// Lock a sequence's live enrollments in id order. The rows come without
    /// their rendered steps, which pause and delete don't read.
    fn lock_live_enrollments(
        &self,
        tx: &mut Self::Tx,
        sequence_id: Uuid,
    ) -> impl Future<Output = Result<Vec<EnrollmentRow>, Self::Err>> + Send;

    // Enrollments.

    /// The sequence and team of one of the owner's enrollments.
    fn owned_enrollment(
        &self,
        owner: &Owner,
        id: Uuid,
    ) -> impl Future<Output = Result<Option<EnrollmentSummary>, Self::Err>> + Send;
    /// One of the owner's enrollments with its steps.
    fn enrollment_detail(
        &self,
        owner: &Owner,
        id: Uuid,
    ) -> impl Future<Output = Result<Option<EnrollmentDetail>, Self::Err>> + Send;
    /// Lock an enrollment (`FOR UPDATE`, never its sequence). `skip_locked`
    /// returns `None` when another transaction holds it.
    fn lock_enrollment(
        &self,
        tx: &mut Self::Tx,
        id: Uuid,
        skip_locked: bool,
    ) -> impl Future<Output = Result<Option<EnrollmentRow>, Self::Err>> + Send;
    /// The enrollment's step history in step order, read after its lock.
    fn history(
        &self,
        tx: &mut Self::Tx,
        enrollment_id: Uuid,
    ) -> impl Future<Output = Result<Vec<HistoryRow>, Self::Err>> + Send;
    /// Write an enrollment's mutable fields.
    fn update_enrollment(
        &self,
        tx: &mut Self::Tx,
        row: &EnrollmentRow,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
    /// Record a new unsent step.
    fn insert_step(
        &self,
        tx: &mut Self::Tx,
        enrollment_id: Uuid,
        step: i16,
        message_id: Uuid,
        scheduled_at: DateTime<Utc>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
    /// Mark a step sent.
    fn mark_sent(
        &self,
        tx: &mut Self::Tx,
        enrollment_id: Uuid,
        step: i16,
        sent: &SentStep,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
    /// Mark a step unknown: it may have been sent and is never resent.
    fn mark_unknown(
        &self,
        tx: &mut Self::Tx,
        enrollment_id: Uuid,
        step: i16,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
    /// Forget a withdrawn step so it can be created again.
    fn delete_step(
        &self,
        tx: &mut Self::Tx,
        enrollment_id: Uuid,
        step: i16,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    // Enrolling and unsubscribing.

    /// Upsert recipient rows for the addresses (sorted), returning each
    /// address's stored token and state.
    fn upsert_recipients(
        &self,
        tx: &mut Self::Tx,
        team_id: Uuid,
        emails: &[String],
    ) -> impl Future<Output = Result<Vec<(String, RecipientState)>, Self::Err>> + Send;
    /// Insert an enrollment; `None` if the address is already in the sequence.
    fn insert_enrollment(
        &self,
        tx: &mut Self::Tx,
        enrollment: &NewEnrollment<'_>,
    ) -> impl Future<Output = Result<Option<Uuid>, Self::Err>> + Send;
    /// A recipient's state.
    fn recipient(
        &self,
        tx: &mut Self::Tx,
        team_id: Uuid,
        email: &str,
    ) -> impl Future<Output = Result<Option<RecipientState>, Self::Err>> + Send;
    /// Unsubscribe the token's address, committed on its own. Returns the
    /// team and address, or `None` for an unknown token.
    fn unsubscribe_token(
        &self,
        token: &UnsubscribeToken,
    ) -> impl Future<Output = Result<Option<(Uuid, String)>, Self::Err>> + Send;
    /// Unsubscribe an address by hand, committed on its own.
    fn unsubscribe_address(
        &self,
        team_id: Uuid,
        email: &str,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
    /// Live enrollments of an address in a team, across owners.
    fn live_enrollments_of_address(
        &self,
        team_id: Uuid,
        email: &str,
    ) -> impl Future<Output = Result<Vec<Uuid>, Self::Err>> + Send;
    /// A contact's enrollments in a team, as any teammate sees them.
    fn contact_enrollments(
        &self,
        team_id: Uuid,
        email: &str,
        viewer: &str,
    ) -> impl Future<Output = Result<Vec<ContactEnrollment>, Self::Err>> + Send;

    // Sweep.

    /// Enrollments with an unsent step, after `after` in `(scheduled_at, id)` order.
    fn scheduled_page(
        &self,
        after: Option<(DateTime<Utc>, Uuid)>,
        limit: i64,
    ) -> impl Future<Output = Result<Vec<(DateTime<Utc>, Uuid)>, Self::Err>> + Send;
    /// Active enrollments due for a step, after `after` in `(due_at, id)`
    /// order, leaving out those sending from `skip_inboxes`.
    fn due_page(
        &self,
        after: Option<(DateTime<Utc>, Uuid)>,
        limit: i64,
        skip_inboxes: &[Uuid],
    ) -> impl Future<Output = Result<Vec<DueEnrollment>, Self::Err>> + Send;
    /// Give active enrollments with neither a due time nor an unsent step a
    /// due time, so none waits forever. Returns how many.
    fn heal_stranded(
        &self,
        due_at: DateTime<Utc>,
    ) -> impl Future<Output = Result<u64, Self::Err>> + Send;
    /// Push an enrollment's due time back after a failed attempt to create its step.
    fn defer(
        &self,
        enrollment_id: Uuid,
        due_at: DateTime<Utc>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
    /// Which of these messages are some enrollment's step.
    fn known_steps(
        &self,
        message_ids: &[Uuid],
    ) -> impl Future<Output = Result<Vec<Uuid>, Self::Err>> + Send;
    /// Whether the inbox has any live enrollment.
    fn has_live_enrollments(
        &self,
        link_id: Uuid,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;
    /// Live enrollments on the inbox an incoming message may answer.
    fn reply_candidates(
        &self,
        candidates: ReplyCandidates<'_>,
    ) -> impl Future<Output = Result<Vec<Uuid>, Self::Err>> + Send;
}

/// Who may use sequences, and which CRM people they may enroll.
pub trait OwnerAccess: Send + Sync + 'static {
    /// Adapter error.
    type Err: std::error::Error + Send + Sync + 'static;

    /// The user's team.
    fn team_of(
        &self,
        user_id: &str,
    ) -> impl Future<Output = Result<Option<Uuid>, Self::Err>> + Send;
    /// Whether the team has CRM on.
    fn crm_enabled(&self, team_id: Uuid) -> impl Future<Output = Result<bool, Self::Err>> + Send;
    /// The CRM people the user can see among `ids`.
    fn people(
        &self,
        user_id: &str,
        ids: &[Uuid],
    ) -> impl Future<Output = Result<Vec<CrmPerson>, Self::Err>> + Send;
}

/// The sequences API, as the HTTP adapter drives it.
pub trait SequencesApi: Send + Sync + 'static {
    /// The owner's sequences.
    fn list(
        &self,
        user_id: &str,
    ) -> impl Future<Output = Result<Vec<SequenceSummary>, SequenceError>> + Send;
    /// Create a draft sequence.
    fn create(
        &self,
        user_id: &str,
        input: NewSequence,
    ) -> impl Future<Output = Result<Sequence, SequenceError>> + Send;
    /// A sequence with its enrollments.
    fn get(
        &self,
        user_id: &str,
        id: Uuid,
    ) -> impl Future<Output = Result<(Sequence, Vec<EnrollmentSummary>), SequenceError>> + Send;
    /// Edit a sequence or change its status.
    fn update(
        &self,
        user_id: &str,
        id: Uuid,
        patch: SequencePatch,
    ) -> impl Future<Output = Result<Sequence, SequenceError>> + Send;
    /// Delete a sequence.
    fn delete(
        &self,
        user_id: &str,
        id: Uuid,
    ) -> impl Future<Output = Result<(), SequenceError>> + Send;
    /// Enroll CRM people.
    fn enroll(
        &self,
        user_id: &str,
        id: Uuid,
        request: EnrollRequest,
    ) -> impl Future<Output = Result<Vec<EnrollResult>, SequenceError>> + Send;
    /// An enrollment with its steps.
    fn enrollment(
        &self,
        user_id: &str,
        id: Uuid,
    ) -> impl Future<Output = Result<EnrollmentDetail, SequenceError>> + Send;
    /// Act on an enrollment.
    fn act(
        &self,
        user_id: &str,
        id: Uuid,
        action: EnrollmentAction,
    ) -> impl Future<Output = Result<EnrollmentSummary, SequenceError>> + Send;
    /// A CRM person's enrollments.
    fn contact_enrollments(
        &self,
        user_id: &str,
        crm_contact_id: Uuid,
    ) -> impl Future<Output = Result<Vec<ContactEnrollment>, SequenceError>> + Send;
    /// Record a one-click unsubscribe; `false` for an unknown token.
    fn unsubscribe(&self, token: &str) -> impl Future<Output = Result<bool, SequenceError>> + Send;
}
