use chrono::{DateTime, Utc};
use uuid::Uuid;

use super::{LabelListVisibility, LabelType, MessageListVisibility, contact::ContactInfo};

/// A lightweight label representation for parsed messages.
#[derive(Debug, Clone)]
pub struct ParsedLabel {
    /// Database ID of the label, when persisted.
    pub id: Option<Uuid>,
    /// Link ID the label belongs to.
    pub link_id: Uuid,
    /// The provider label ID (e.g., "INBOX", "DRAFT").
    pub provider_id: String,
    /// The human-readable label name.
    pub name: String,
    /// When the label was created.
    pub created_at: DateTime<Utc>,
    /// Message-list visibility, when known.
    pub message_list_visibility: Option<MessageListVisibility>,
    /// Label-list visibility, when known.
    pub label_list_visibility: Option<LabelListVisibility>,
    /// System or user label type, when known.
    pub type_: Option<LabelType>,
}

/// A lightweight message with parsed body text, without attachments or scheduled send times.
#[derive(Debug, Clone)]
pub struct ParsedMessage {
    /// Database ID of the message.
    pub db_id: Uuid,
    /// Link ID this message belongs to.
    pub link_id: Uuid,
    /// Database ID of the thread this message belongs to.
    pub thread_db_id: Uuid,
    /// Message subject.
    pub subject: Option<String>,
    /// Message snippet.
    pub snippet: Option<String>,
    /// Sender contact info.
    pub from: Option<ContactInfo>,
    /// To recipients.
    pub to: Vec<ContactInfo>,
    /// Cc recipients.
    pub cc: Vec<ContactInfo>,
    /// Bcc recipients.
    pub bcc: Vec<ContactInfo>,
    /// Labels on this message.
    pub labels: Vec<ParsedLabel>,
    /// The body parsed into plaintext (from body_replyless, with HTML converted if needed).
    pub body_parsed: Option<String>,
    /// Plain text body.
    pub body_text: Option<String>,
    /// Sanitized HTML body.
    pub body_html_sanitized: Option<String>,
    /// Macro-format body.
    pub body_macro: Option<String>,
    /// Body with reply/forwarded content stripped.
    pub body_replyless: Option<String>,
    /// Internal date timestamp from the provider.
    pub internal_date_ts: Option<DateTime<Utc>>,
    /// When the message was sent.
    pub sent_at: Option<DateTime<Utc>>,
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
    /// When the message was created.
    pub created_at: DateTime<Utc>,
    /// When the message was last updated.
    pub updated_at: DateTime<Utc>,
}

/// A thread with lightweight parsed messages.
#[derive(Debug, Clone)]
pub struct ParsedThread {
    /// The thread metadata.
    pub row: super::thread::ThreadRow,
    /// Parsed messages in the thread.
    pub messages: Vec<ParsedMessage>,
    /// The distinct labels across all of the thread's messages. Unlike the
    /// per-message labels, this is not limited to the fetched message page.
    pub labels: Vec<ParsedLabel>,
}
