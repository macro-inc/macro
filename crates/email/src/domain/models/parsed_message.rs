use chrono::{DateTime, Utc};
use uuid::Uuid;

use super::{contact::ContactInfo, message::Message};

/// A lightweight label representation for parsed messages.
#[derive(Debug, Clone)]
pub struct ParsedLabel {
    /// The provider label ID (e.g., "INBOX", "DRAFT").
    pub provider_id: String,
    /// The human-readable label name.
    pub name: String,
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

impl From<&Message> for ParsedMessage {
    fn from(message: &Message) -> Self {
        let body_parsed = email_utils::body_parsed::compute_body_parsed(
            message.body_html_sanitized.is_some(),
            &message.body_replyless,
        );

        Self {
            db_id: message.db_id,
            link_id: message.link_id,
            thread_db_id: message.thread_db_id,
            subject: message.subject.clone(),
            snippet: message.snippet.clone(),
            from: message.from.clone(),
            to: message.to.clone(),
            cc: message.cc.clone(),
            bcc: message.bcc.clone(),
            labels: message
                .labels
                .iter()
                .map(|label| ParsedLabel {
                    provider_id: label.provider_label_id.clone(),
                    name: label.name.clone().unwrap_or_default(),
                })
                .collect(),
            body_parsed,
            body_text: message.body_text.clone(),
            body_html_sanitized: message.body_html_sanitized.clone(),
            body_macro: message.body_macro.clone(),
            body_replyless: message.body_replyless.clone(),
            internal_date_ts: message.internal_date_ts,
            sent_at: message.sent_at,
            is_read: message.is_read,
            is_starred: message.is_starred,
            is_sent: message.is_sent,
            is_draft: message.is_draft,
            has_attachments: message.has_attachments,
            created_at: message.created_at,
            updated_at: message.updated_at,
        }
    }
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
