use chrono::{DateTime, Utc};
use uuid::Uuid;

use super::contact::ContactInfo;

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
    /// Internal date timestamp from the provider.
    pub internal_date_ts: Option<DateTime<Utc>>,
}

/// A thread with lightweight parsed messages.
#[derive(Debug, Clone)]
pub struct ParsedThread {
    /// The thread metadata.
    pub row: super::thread::ThreadRow,
    /// Parsed messages in the thread.
    pub messages: Vec<ParsedMessage>,
}
