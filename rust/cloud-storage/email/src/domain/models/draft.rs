use chrono::{DateTime, Utc};
use serde_json::Value as JsonValue;
use uuid::Uuid;

use super::contact::{ContactInfo, RecipientType};

/// Input for creating a draft message. Mirrors the fields from `MessageToSend`.
#[derive(Debug, Clone)]
pub struct CreateDraftInput {
    /// Existing message DB ID (for updating an existing draft).
    pub db_id: Option<Uuid>,
    /// Provider message ID.
    pub provider_id: Option<String>,
    /// ID of the message this draft is replying to.
    pub replying_to_id: Option<Uuid>,
    /// Provider thread ID.
    pub provider_thread_id: Option<String>,
    /// Thread DB ID (set if this draft belongs to an existing thread).
    pub thread_db_id: Option<Uuid>,
    /// Subject line of the draft.
    pub subject: String,
    /// To recipients.
    pub to: Vec<ContactInfo>,
    /// Cc recipients.
    pub cc: Vec<ContactInfo>,
    /// Bcc recipients.
    pub bcc: Vec<ContactInfo>,
    /// Plain text body.
    pub body_text: Option<String>,
    /// HTML body (base64 encoded from the client, decoded before storage).
    pub body_html: Option<String>,
    /// Macro-specific body format.
    pub body_macro: Option<String>,
    /// Headers JSON (e.g. Macro-In-Reply-To).
    pub headers_json: Option<JsonValue>,
    /// Scheduled send time.
    pub send_time: Option<DateTime<Utc>>,
}

/// A draft input with all IDs resolved, ready for database insertion.
/// Created from `CreateDraftInput` after validation and ID generation.
#[derive(Debug, Clone)]
pub struct ResolvedDraftInput {
    /// The resolved message DB ID.
    pub db_id: Uuid,
    /// Provider message ID.
    pub provider_id: Option<String>,
    /// ID of the message this draft is replying to.
    pub replying_to_id: Option<Uuid>,
    /// Provider thread ID.
    pub provider_thread_id: Option<String>,
    /// The resolved thread DB ID.
    pub thread_db_id: Uuid,
    /// Subject line of the draft.
    pub subject: String,
    /// To recipients.
    pub to: Vec<ContactInfo>,
    /// Cc recipients.
    pub cc: Vec<ContactInfo>,
    /// Bcc recipients.
    pub bcc: Vec<ContactInfo>,
    /// Plain text body.
    pub body_text: Option<String>,
    /// HTML body (decoded).
    pub body_html: Option<String>,
    /// Macro-specific body format.
    pub body_macro: Option<String>,
    /// Headers JSON (e.g. Macro-In-Reply-To).
    pub headers_json: Option<JsonValue>,
    /// Scheduled send time.
    pub send_time: Option<DateTime<Utc>>,
}

/// Simplified message info used for validation queries.
#[derive(Debug, Clone)]
pub struct SimpleMessageInfo {
    /// Database ID of the message.
    pub db_id: Uuid,
    /// Thread database ID.
    pub thread_db_id: Uuid,
    /// Provider thread ID.
    pub provider_thread_id: Option<String>,
    /// Headers JSON.
    pub headers_json: Option<JsonValue>,
    /// Whether the message has been sent.
    pub is_sent: bool,
    /// Whether the message is a draft.
    pub is_draft: bool,
}

/// The result of creating a draft.
#[derive(Debug, Clone)]
pub struct CreatedDraft {
    /// The assigned or existing message DB ID.
    pub db_id: Uuid,
    /// Provider message ID.
    pub provider_id: Option<String>,
    /// ID of the message this draft is replying to.
    pub replying_to_id: Option<Uuid>,
    /// Provider thread ID.
    pub provider_thread_id: Option<String>,
    /// Thread DB ID.
    pub thread_db_id: Uuid,
    /// Link ID.
    pub link_id: Uuid,
    /// Subject.
    pub subject: String,
    /// To recipients.
    pub to: Vec<ContactInfo>,
    /// Cc recipients.
    pub cc: Vec<ContactInfo>,
    /// Bcc recipients.
    pub bcc: Vec<ContactInfo>,
    /// Plain text body.
    pub body_text: Option<String>,
    /// HTML body (decoded).
    pub body_html: Option<String>,
    /// Macro body.
    pub body_macro: Option<String>,
    /// Headers JSON.
    pub headers_json: Option<JsonValue>,
    /// Scheduled send time.
    pub send_time: Option<DateTime<Utc>>,
}

/// Parsed from/to/cc/bcc addresses for contact upsert.
#[derive(Debug, Clone)]
pub struct ParsedAddresses {
    /// The from email address.
    pub from_email: String,
    /// The from display name.
    pub from_name: Option<String>,
    /// To recipients.
    pub to: Vec<ContactInfo>,
    /// Cc recipients.
    pub cc: Vec<ContactInfo>,
    /// Bcc recipients.
    pub bcc: Vec<ContactInfo>,
}

/// Result of upserting contacts for a draft.
#[derive(Debug, Clone)]
pub struct UpsertedContacts {
    /// The contact ID of the sender.
    pub from_contact_id: Option<Uuid>,
    /// The upserted recipients.
    pub recipients: Vec<UpsertedRecipient>,
}

/// A single upserted recipient.
#[derive(Debug, Clone)]
pub struct UpsertedRecipient {
    /// Contact ID.
    pub contact_id: Uuid,
    /// Display name.
    pub name: Option<String>,
    /// Recipient type (to, cc, bcc).
    pub recipient_type: RecipientType,
}
