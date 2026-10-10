//! Replay-safe admission and cancellation of an approved email snapshot.

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::models::{
    ContactInfo, CreateDraftInput, EmailErr, ResolvedDraftInput, ThreadRow, UpsertedContacts,
};

/// Frozen delivery content after validation, sanitization and signature injection.
/// The raw request remains separate for exact idempotency comparisons.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreparedSendContent {
    /// Message content and identities as settled by admission.
    pub message: ResolvedDraftInput,
    /// Sender identity captured at admission, independent of later contact sync.
    pub sender: ContactInfo,
}

/// Older or invalid admitted content cannot safely be reconstructed from live rows.
#[derive(Debug, thiserror::Error)]
#[error("approved email content is unavailable; cancel and review the draft before sending")]
pub struct PreparedSendContentUnavailable;

/// Unique identity for one explicit Send action, retained across retries.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct SendAttemptId(pub Uuid);

/// Content approved at Send. Attachment references name completed uploads only.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SendSnapshot {
    /// Full message state, with client handles where server IDs are unknown.
    pub message: CreateDraftInput,
    /// Uploaded draft attachment IDs.
    pub attachment_ids: Vec<Uuid>,
    /// Original attachment IDs for forwarded attachments.
    pub forwarded_attachment_ids: Vec<Uuid>,
    /// Original editor HTML, encoded like message HTML; omitted values use the approved body.
    pub restore_body_html: Option<String>,
    /// Original editor text; omitted values use the approved body.
    pub restore_body_text: Option<String>,
    /// Original editor document; omitted values use the approved body.
    pub restore_body_macro: Option<String>,
}

/// Authoritative state of an admitted or cancelled send attempt.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SendAttemptStatus {
    /// Committed and awaiting provider submission; cancellation is still safe.
    Accepted,
    /// Provider submission began, or a legacy worker owns an ambiguous claim.
    Sending,
    /// Preparation or provider rejection needs attention; cancellation is safe.
    Failed,
    /// Provider acceptance is uncertain; automatic resubmission is forbidden.
    DeliveryUnconfirmed,
    /// Provider delivery was recorded successfully.
    Sent,
    /// Delivery authority was revoked, including before admission.
    Cancelled,
}

/// Stable admission result, independent of response hydration and SQS availability.
#[derive(Debug, Clone)]
pub struct SendAttempt {
    /// Whether this invocation changed delivery authority (for event publication).
    pub transitioned: bool,
    /// Fully hydrated current message, loaded only after authorization.
    pub message: Option<super::models::Message>,
    /// The caller's attempt identity.
    pub attempt_id: SendAttemptId,
    /// Current authoritative delivery state.
    pub status: SendAttemptStatus,
    /// Message identity, absent for cancellation before admission.
    pub message_id: Option<Uuid>,
    /// Conversation identity, absent before admission.
    pub thread_id: Option<Uuid>,
    /// Deadline assigned at first admission, never extended by replay.
    pub send_time: Option<DateTime<Utc>>,
}

/// Validated data for atomic admission. Preparation performs no delivery writes.
pub struct PreparedSend {
    /// Authorized source inbox to move atomically with admission, if changed.
    pub source_inbox: Option<SendSourceInbox>,
    /// Undo delay measured at atomic admission, after acquiring message locks.
    pub undo_delay_secs: u32,
    /// Original immutable request, for detecting mismatched retries.
    pub snapshot: SendSnapshot,
    /// Sanitized message and server-generated candidate identities.
    pub message: ResolvedDraftInput,
    /// Resolved recipients.
    pub contacts: UpsertedContacts,
    /// New conversation, if necessary.
    pub new_thread: Option<ThreadRow>,
    /// Sanitized restoration HTML.
    pub restore_html: Option<String>,
    /// Restoration text, defaulted from the approved body.
    pub restore_text: Option<String>,
    /// Restoration editor document, defaulted from the approved body.
    pub restore_macro: Option<String>,
}

/// Existing editable draft ownership validated before sending from another inbox.
#[derive(Debug, Clone, Copy)]
pub struct SendSourceInbox {
    /// Inbox whose draft the actor was authorized to edit.
    pub link_id: Uuid,
    /// Original conversation, revalidated under the message lock.
    pub thread_id: Uuid,
}

/// Persistence operations serialize admission/cancellation and message delivery locks.
pub trait EmailSendRepo: Send + Sync {
    /// Fetch the authorized attempt's current message for response hydration.
    fn send_message_row(
        &self,
        link_id: Uuid,
        message_id: Uuid,
    ) -> impl Future<Output = Result<Option<super::models::MessageRow>, EmailErr>> + Send;
    /// Read an attempt, optionally verifying that its approved content matches.
    fn read_send_attempt(
        &self,
        actor: &MacroUserIdStr<'_>,
        link_id: Uuid,
        attempt_id: SendAttemptId,
        snapshot: Option<&SendSnapshot>,
    ) -> impl Future<Output = Result<Option<SendAttempt>, EmailErr>> + Send;
    /// Commit the attempt, message and schedule together, or return the prior attempt.
    fn admit_send(
        &self,
        actor: &MacroUserIdStr<'_>,
        link_id: Uuid,
        attempt_id: SendAttemptId,
        prepared: PreparedSend,
    ) -> impl Future<Output = Result<SendAttempt, EmailErr>> + Send;
    /// Persist cancellation, even before admission; never cancel another attempt.
    /// Managed preparation remains cancellable until its fenced submission
    /// boundary. Submitted or ambiguous legacy claims must remain locked.
    fn cancel_send(
        &self,
        actor: &MacroUserIdStr<'_>,
        link_id: Uuid,
        attempt_id: SendAttemptId,
    ) -> impl Future<Output = Result<SendAttempt, EmailErr>> + Send;
}

/// Authenticated user-facing delivery capability.
pub trait EmailSendService: Send + Sync {
    /// Authorize the selected inbox and durably admit the approved snapshot.
    fn send_email(
        &self,
        actor: MacroUserIdStr<'static>,
        link_id: Uuid,
        attempt_id: SendAttemptId,
        snapshot: SendSnapshot,
    ) -> impl Future<Output = Result<SendAttempt, EmailErr>> + Send;
    /// Cancel this attempt or report that delivery already started.
    fn cancel_email_send(
        &self,
        actor: MacroUserIdStr<'static>,
        link_id: Uuid,
        attempt_id: SendAttemptId,
    ) -> impl Future<Output = Result<SendAttempt, EmailErr>> + Send;
    /// Read status after navigation/restart without reissuing a send.
    fn email_send_status(
        &self,
        actor: MacroUserIdStr<'static>,
        link_id: Uuid,
        attempt_id: SendAttemptId,
    ) -> impl Future<Output = Result<Option<SendAttempt>, EmailErr>> + Send;
}
