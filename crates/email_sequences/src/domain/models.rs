//! Sequences, enrollments, their steps, and the errors the API reports.

use chrono::{DateTime, NaiveTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Where a sequence is in its lifecycle.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    strum::EnumString,
    strum::IntoStaticStr,
)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum SequenceStatus {
    /// Being written; nothing sends.
    Draft,
    /// Enrollments send.
    Active,
    /// Nothing new is scheduled until it is active again.
    Paused,
}

/// Where one contact is in a sequence.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    strum::EnumString,
    strum::IntoStaticStr,
)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum EnrollmentStatus {
    /// Steps are scheduled as they come due.
    Active,
    /// Paused by the owner.
    Paused,
    /// Stopped sending until the owner acts; see the reason.
    NeedsAttention,
    /// Ended before the last step; see the reason.
    Stopped,
    /// Every step was sent.
    Completed,
}

impl EnrollmentStatus {
    /// Whether the enrollment may still send.
    pub fn is_live(self) -> bool {
        matches!(self, Self::Active | Self::Paused | Self::NeedsAttention)
    }
}

/// Why an enrollment stopped or needs attention.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    strum::EnumString,
    strum::IntoStaticStr,
)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum EnrollmentReason {
    /// The owner stopped it.
    Manual,
    /// The contact replied.
    Replied,
    /// A step bounced.
    Bounced,
    /// The address unsubscribed from the team's sequences.
    Unsubscribed,
    /// The owner left the team or the team turned CRM off.
    AccessLost,
    /// The sending inbox is disconnected or needs reauthorization.
    InboxUnavailable,
    /// Gmail refused a step and automatic retries ran out.
    StepFailed,
    /// A step was taken out of the schedule outside the sequence.
    StepWithdrawn,
    /// A step's email disappeared; it may have been sent.
    StepUnknown,
    /// A step is well past its send time and still unsent.
    StepStuck,
}

/// State of one step's email.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Serialize,
    Deserialize,
    strum::EnumString,
    strum::IntoStaticStr,
)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum StepStatus {
    /// Not created yet.
    Pending,
    /// Scheduled in the sender's inbox and not sent yet.
    Scheduled,
    /// Sent.
    Sent,
    /// The email disappeared before it was seen sent; never resent.
    Unknown,
}

/// One email of a sequence. A sequence holds templates; an enrollment holds
/// them rendered for its contact.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct Step {
    /// Calendar days after the previous step, at the enrollment's send time.
    pub delay_days: u16,
    /// Subject line; a reply step uses its thread's subject instead.
    pub subject: String,
    /// Plain-text body.
    pub body: String,
    /// Send as a reply in the previous email's thread.
    #[serde(default)]
    pub as_reply: bool,
}

/// A sequence as its owner edits it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct Sequence {
    /// Sequence id.
    pub id: Uuid,
    /// Display name.
    pub name: String,
    /// The owner's Gmail inbox it sends from.
    pub link_id: Option<Uuid>,
    /// Line added above the unsubscribe link in every email.
    pub footer: String,
    /// Lifecycle status.
    pub status: SequenceStatus,
    /// Step templates.
    pub steps: Vec<Step>,
    /// Incremented by every change; edits must name the version they saw.
    pub version: i32,
    /// When it was created.
    pub created_at: DateTime<Utc>,
    /// When it last changed.
    pub updated_at: DateTime<Utc>,
}

/// Enrollment counts by status.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct EnrollmentCounts {
    /// Sending as steps come due.
    pub active: i64,
    /// Paused by the owner.
    pub paused: i64,
    /// Waiting on the owner.
    pub needs_attention: i64,
    /// Ended early.
    pub stopped: i64,
    /// Finished.
    pub completed: i64,
}

/// A sequence in the owner's list.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct SequenceSummary {
    /// Sequence id.
    pub id: Uuid,
    /// Display name.
    pub name: String,
    /// Lifecycle status.
    pub status: SequenceStatus,
    /// Number of steps.
    pub step_count: i32,
    /// Enrollments by status.
    pub counts: EnrollmentCounts,
    /// When it last changed.
    pub updated_at: DateTime<Utc>,
}

/// One contact's progress through a sequence.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct EnrollmentSummary {
    /// Enrollment id.
    pub id: Uuid,
    /// The CRM person enrolled; gone if the contact was deleted.
    pub crm_contact_id: Option<Uuid>,
    /// Address the steps go to.
    pub email: String,
    /// Name at enrollment.
    pub contact_name: Option<String>,
    /// Status.
    pub status: EnrollmentStatus,
    /// Why it stopped or needs attention.
    pub reason: Option<EnrollmentReason>,
    /// Index of the next step to send.
    pub next_step: i16,
    /// Number of steps.
    pub step_count: i32,
    /// When the last step was sent.
    pub last_sent_at: Option<DateTime<Utc>>,
    /// When the next step is scheduled or due.
    pub next_send_at: Option<DateTime<Utc>>,
    /// When it was enrolled.
    pub created_at: DateTime<Utc>,
}

/// One rendered step of an enrollment with what happened to it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct EnrollmentStep {
    /// The step as rendered for this contact.
    #[serde(flatten)]
    pub step: Step,
    /// What happened to its email.
    pub status: StepStatus,
    /// When it was scheduled to send.
    pub scheduled_at: Option<DateTime<Utc>>,
    /// When it was sent.
    pub sent_at: Option<DateTime<Utc>>,
}

/// An enrollment with its rendered steps.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct EnrollmentDetail {
    /// The enrollment.
    #[serde(flatten)]
    pub enrollment: EnrollmentSummary,
    /// Its steps in order.
    pub steps: Vec<EnrollmentStep>,
}

/// A contact's enrollment as any teammate sees it: never step content.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct ContactEnrollment {
    /// Sequence id.
    pub sequence_id: Uuid,
    /// Sequence name.
    pub sequence_name: String,
    /// Macro user id of the sequence's owner.
    pub owner_id: String,
    /// Whether the viewer owns the sequence.
    pub is_owner: bool,
    /// Enrollment status.
    pub status: EnrollmentStatus,
    /// Why it stopped or needs attention.
    pub reason: Option<EnrollmentReason>,
    /// Whether the whole sequence is paused.
    pub sequence_paused: bool,
    /// When the last step was sent.
    pub last_sent_at: Option<DateTime<Utc>>,
    /// When the next step is scheduled or due.
    pub next_send_at: Option<DateTime<Utc>>,
}

/// The address a sequence writes to, as enrolled.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Recipient {
    /// Trimmed, lowercased address.
    pub email: String,
    /// Display name, if the CRM has one.
    pub name: Option<String>,
}

/// When an enrollment's steps go out, in its contact-facing local time.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SendClock {
    /// IANA time zone the enrollment was started in.
    pub timezone: chrono_tz::Tz,
    /// Local time of day every step after the first is sent at.
    pub send_time: NaiveTime,
}

/// The signed-in owner of sequences: a user and the team they act in.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Owner {
    /// Macro user id.
    pub user_id: String,
    /// The user's team.
    pub team_id: Uuid,
}

/// An enrollment as the sweep and owner actions read it, under its row lock.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnrollmentRow {
    /// Enrollment id.
    pub id: Uuid,
    /// Its sequence.
    pub sequence_id: Uuid,
    /// The sequence's owner.
    pub owner_id: String,
    /// The team it belongs to.
    pub team_id: Uuid,
    /// The sequence's status.
    pub sequence_status: SequenceStatus,
    /// The sequence's current sender.
    pub sequence_link_id: Option<Uuid>,
    /// The inbox this enrollment sends from.
    pub link_id: Option<Uuid>,
    /// Enrolled address, normalized.
    pub email: String,
    /// Name at enrollment.
    pub contact_name: Option<String>,
    /// Rendered steps.
    pub steps: Vec<Step>,
    /// Status.
    pub status: EnrollmentStatus,
    /// Why it stopped or needs attention.
    pub reason: Option<EnrollmentReason>,
    /// Index of the next step to create.
    pub next_step: i16,
    /// When the next step is due, while active.
    pub due_at: Option<DateTime<Utc>>,
    /// Automatic retries of the current step.
    pub attempts: i16,
    /// Local send clock.
    pub clock: SendClock,
    /// Incoming mail after this can stop it.
    pub replies_after: Option<DateTime<Utc>>,
}

/// One step's email, as recorded.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HistoryRow {
    /// Step index.
    pub step: i16,
    /// Local message id of the step's email.
    pub message_id: Uuid,
    /// Message-ID minted for the send.
    pub delivery_message_id: Option<String>,
    /// Message-ID of the synced sent copy, without angle brackets.
    pub provider_message_id: Option<String>,
    /// `Scheduled`, `Sent` or `Unknown`.
    pub status: StepStatus,
    /// When it was scheduled to send.
    pub scheduled_at: DateTime<Utc>,
    /// When it was sent.
    pub sent_at: Option<DateTime<Utc>>,
}

/// A CRM person the owner may enroll.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CrmPerson {
    /// CRM contact id.
    pub id: Uuid,
    /// Team owning the record.
    pub team_id: Uuid,
    /// Address as the CRM stores it.
    pub email: String,
    /// Display name.
    pub name: Option<String>,
}

/// The credential in an unsubscribe link: 32 random bytes, base64url.
#[derive(Clone, PartialEq, Eq)]
pub struct UnsubscribeToken(String);

impl UnsubscribeToken {
    const ENCODED_LEN: usize = 43;

    /// A fresh random token.
    pub fn generate() -> Self {
        use base64::Engine as _;
        use rand::RngCore as _;
        let mut bytes = [0_u8; 32];
        rand::rng().fill_bytes(&mut bytes);
        Self(base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes))
    }

    /// A token taken from a link, if it has a token's shape.
    pub fn parse(raw: &str) -> Option<Self> {
        (raw.len() == Self::ENCODED_LEN
            && raw
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'))
        .then(|| Self(raw.to_owned()))
    }

    /// The encoded token.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Debug for UnsubscribeToken {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("UnsubscribeToken(..)")
    }
}

/// An address as sequences store and compare it.
pub fn normalize_email(email: &str) -> String {
    email.trim().to_lowercase()
}

/// What an owner can do to an enrollment.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, strum::IntoStaticStr)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum EnrollmentAction {
    /// Stop sending until resumed.
    Pause,
    /// Continue; withdraws a stuck or failed step first and never resends one
    /// that may have gone out.
    Resume,
    /// End it.
    Stop,
    /// Add the address to the team's unsubscribe list and stop every
    /// enrollment of it.
    Unsubscribe,
}

/// Why a contact wasn't enrolled.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum EnrollSkip {
    /// Not a CRM person the owner can see in their team.
    NotFound,
    /// The person has no address.
    NoEmail,
    /// The address isn't one email can be sent to.
    InvalidEmail,
    /// The address unsubscribed from the team's sequences.
    Unsubscribed,
    /// The address is already in this sequence.
    AlreadyEnrolled,
}

/// What enrolling one contact did.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct EnrollResult {
    /// The CRM person.
    pub crm_contact_id: Uuid,
    /// The new enrollment.
    pub enrollment_id: Option<Uuid>,
    /// Why it was skipped.
    pub skipped: Option<EnrollSkip>,
}

/// Failures the sequences API reports.
#[derive(Debug, thiserror::Error)]
pub enum SequenceError {
    /// No such sequence or enrollment belongs to the caller.
    #[error("not found")]
    NotFound,
    /// The sequence changed since the caller read it.
    #[error("the sequence changed since it was loaded")]
    VersionConflict,
    /// The status change isn't allowed from the current status.
    #[error("that status change isn't allowed")]
    InvalidTransition,
    /// The sequence is invalid.
    #[error(transparent)]
    Invalid(#[from] super::render::InvalidSequence),
    /// Contacts can only join an active sequence.
    #[error("the sequence isn't active")]
    SequenceNotActive,
    /// Too many contacts in one request.
    #[error("too many contacts")]
    TooManyContacts,
    /// The start time isn't usable.
    #[error("invalid start time")]
    InvalidStart,
    /// The time zone isn't an IANA zone.
    #[error("invalid time zone")]
    InvalidTimezone,
    /// The action doesn't apply to the enrollment's status.
    #[error("that action isn't available")]
    ActionUnavailable,
    /// A step is being delivered and can't be withdrawn yet.
    #[error("a step is being delivered")]
    StepInDelivery,
    /// The owner scheduled or sent the step's email from Mail; it is theirs
    /// until they send or delete it.
    #[error("the step's email was taken over in Mail")]
    StepTakenOver,
    /// The caller isn't in a team.
    #[error("not in a team")]
    NoTeam,
    /// The caller's team has CRM turned off.
    #[error("CRM is off for the team")]
    CrmDisabled,
    /// Anything else.
    #[error("internal sequences error: {0:?}")]
    Internal(rootcause::Report),
}

impl SequenceError {
    /// Wrap an adapter error.
    pub fn internal(error: impl std::error::Error + Send + Sync + 'static) -> Self {
        Self::Internal(rootcause::Report::new(error).into_dynamic())
    }
}
