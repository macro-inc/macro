use chrono::{DateTime, Utc};

use super::attachment::{AttachmentDraft, AttachmentForwarded, MessageAttachment};
use super::contact::ContactInfo;
use super::label::MessageLabel;

/// The user-visible delivery state of an unsent scheduled message.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "ai_schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum ScheduledSendStatus {
    /// Waiting for its send time or safely retrying preparation.
    Pending,
    /// Provider submission has started, or a legacy claim has an unknown outcome.
    Sending,
    /// Delivery was definitely rejected; cancellation can restore the draft.
    Failed,
    /// Delivery may have succeeded; only reconciliation is safe.
    Unconfirmed,
}

/// Persisted schedule and its delivery state, independent of the client journal.
#[derive(Debug, Clone)]
pub struct ScheduledSend {
    /// The time the user approved for delivery.
    pub send_time: DateTime<Utc>,
    /// Whether delivery is waiting, in progress, failed, or uncertain.
    pub status: ScheduledSendStatus,
}

/// A raw message record without assembled sub-types.
#[derive(Debug, Clone)]
pub struct MessageRow {
    /// Database ID of the message.
    pub db_id: uuid::Uuid,
    /// Provider message ID.
    pub provider_id: Option<String>,
    /// Database ID of the thread this message belongs to.
    pub thread_db_id: uuid::Uuid,
    /// Provider thread ID.
    pub provider_thread_id: Option<String>,
    /// Database ID of the message this is replying to.
    pub replying_to_id: Option<uuid::Uuid>,
    /// Globally unique Message-ID header value.
    pub global_id: Option<String>,
    /// Link ID this message belongs to.
    pub link_id: uuid::Uuid,
    /// Message subject.
    pub subject: Option<String>,
    /// Message snippet.
    pub snippet: Option<String>,
    /// Provider history ID.
    pub provider_history_id: Option<String>,
    /// Internal date timestamp from the provider.
    pub internal_date_ts: Option<DateTime<Utc>>,
    /// When the message was sent.
    pub sent_at: Option<DateTime<Utc>>,
    /// Estimated size of the message.
    pub size_estimate: Option<i64>,
    /// Whether the message has been read.
    pub is_read: bool,
    /// Whether the message is starred.
    pub is_starred: bool,
    /// Whether the message was sent by the user.
    pub is_sent: bool,
    /// Whether the message is a draft.
    pub is_draft: bool,
    /// Whether the message has attachments.
    pub has_attachments: bool,
    /// Plain text body.
    pub body_text: Option<String>,
    /// Sanitized HTML body.
    pub body_html_sanitized: Option<String>,
    /// Macro-format body.
    pub body_macro: Option<String>,
    /// Raw headers as JSON.
    pub headers_json: Option<serde_json::Value>,
    /// When the message was created.
    pub created_at: DateTime<Utc>,
    /// When the message was last updated.
    pub updated_at: DateTime<Utc>,
}

/// A simplified message record with core fields and no assembled sub-types.
#[derive(Debug, Clone)]
pub struct SimpleMessage {
    /// Database ID of the message.
    pub db_id: uuid::Uuid,
    /// Provider message ID.
    pub provider_id: Option<String>,
    /// Database ID of the thread this message belongs to.
    pub thread_db_id: uuid::Uuid,
    /// Provider thread ID.
    pub provider_thread_id: Option<String>,
    /// Database ID of the message this is replying to.
    pub replying_to_id: Option<uuid::Uuid>,
    /// Globally unique Message-ID header value.
    pub global_id: Option<String>,
    /// Link ID this message belongs to.
    pub link_id: uuid::Uuid,
    /// Message subject.
    pub subject: Option<String>,
    /// Message snippet.
    pub snippet: Option<String>,
    /// Database ID of the sender contact.
    pub from_contact_id: Option<uuid::Uuid>,
    /// Provider history ID.
    pub provider_history_id: Option<String>,
    /// Internal date timestamp from the provider.
    pub internal_date_ts: Option<DateTime<Utc>>,
    /// When the message was sent.
    pub sent_at: Option<DateTime<Utc>>,
    /// Estimated size of the message.
    pub size_estimate: Option<i64>,
    /// Whether the message has been read.
    pub is_read: bool,
    /// Whether the message is starred.
    pub is_starred: bool,
    /// Whether the message was sent by the user.
    pub is_sent: bool,
    /// Whether the message is a draft.
    pub is_draft: bool,
    /// Whether the message has attachments.
    pub has_attachments: bool,
    /// Raw headers as JSON.
    pub headers_json: Option<serde_json::Value>,
    /// When the message was created.
    pub created_at: DateTime<Utc>,
    /// When the message was last updated.
    pub updated_at: DateTime<Utc>,
}

/// A fully assembled message with all sub-types resolved.
#[derive(Debug, Clone)]
pub struct Message {
    /// Immutable email-owned scheduling details.
    pub calendar_invitations: Vec<super::calendar_invitation::CalendarInvitation>,
    /// Database ID of the message.
    pub db_id: uuid::Uuid,
    /// Provider message ID.
    pub provider_id: Option<String>,
    /// Database ID of the thread this message belongs to.
    pub thread_db_id: uuid::Uuid,
    /// Provider thread ID.
    pub provider_thread_id: Option<String>,
    /// Database ID of the message this is replying to.
    pub replying_to_id: Option<uuid::Uuid>,
    /// Globally unique Message-ID header value.
    pub global_id: Option<String>,
    /// Link ID this message belongs to.
    pub link_id: uuid::Uuid,
    /// Message subject.
    pub subject: Option<String>,
    /// Message snippet.
    pub snippet: Option<String>,
    /// Provider history ID.
    pub provider_history_id: Option<String>,
    /// Internal date timestamp from the provider.
    pub internal_date_ts: Option<DateTime<Utc>>,
    /// When the message was sent.
    pub sent_at: Option<DateTime<Utc>>,
    /// Estimated size of the message.
    pub size_estimate: Option<i64>,
    /// Whether the message has been read.
    pub is_read: bool,
    /// Whether the message is starred.
    pub is_starred: bool,
    /// Whether the message was sent by the user.
    pub is_sent: bool,
    /// Whether the message is a draft.
    pub is_draft: bool,
    /// Whether the message has attachments.
    pub has_attachments: bool,
    /// Scheduled send time for draft messages.
    pub scheduled_send_time: Option<DateTime<Utc>>,
    /// Delivery recovery state for an unsent scheduled message.
    pub scheduled_send_status: Option<ScheduledSendStatus>,
    /// Sender contact info.
    pub from: Option<ContactInfo>,
    /// To recipients.
    pub to: Vec<ContactInfo>,
    /// Cc recipients.
    pub cc: Vec<ContactInfo>,
    /// Bcc recipients.
    pub bcc: Vec<ContactInfo>,
    /// Labels on this message.
    pub labels: Vec<MessageLabel>,
    /// Plain text body.
    pub body_text: Option<String>,
    /// Sanitized HTML body.
    pub body_html_sanitized: Option<String>,
    /// Macro-format body.
    pub body_macro: Option<String>,
    /// Body with reply/forwarded thread content stripped.
    pub body_replyless: Option<String>,
    /// Provider attachments.
    pub attachments: Vec<MessageAttachment>,
    /// Draft (uploaded) attachments.
    pub attachments_draft: Vec<AttachmentDraft>,
    /// Forwarded attachments.
    pub attachments_forwarded: Vec<AttachmentForwarded>,
    /// Raw headers as JSON.
    pub headers_json: Option<serde_json::Value>,
    /// When the message was created.
    pub created_at: DateTime<Utc>,
    /// When the message was last updated.
    pub updated_at: DateTime<Utc>,
}
