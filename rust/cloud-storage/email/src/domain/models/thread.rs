use chrono::{DateTime, Utc};

use super::message::Message;

/// A thread record without messages.
#[derive(Debug, Clone)]
pub struct ThreadRow {
    /// Database ID of the thread.
    pub db_id: uuid::Uuid,
    /// Provider thread ID.
    pub provider_id: Option<String>,
    /// Link ID this thread belongs to.
    pub link_id: uuid::Uuid,
    /// Whether the thread is visible in the inbox.
    pub inbox_visible: bool,
    /// Whether the thread has been read.
    pub is_read: bool,
    /// Timestamp of the latest inbound message.
    pub latest_inbound_message_ts: Option<DateTime<Utc>>,
    /// Timestamp of the latest outbound message.
    pub latest_outbound_message_ts: Option<DateTime<Utc>>,
    /// Timestamp of the latest non-spam message.
    pub latest_non_spam_message_ts: Option<DateTime<Utc>>,
    /// When the thread was created.
    pub created_at: DateTime<Utc>,
    /// When the thread was last updated.
    pub updated_at: DateTime<Utc>,
}

/// A fully assembled email thread with paginated messages.
#[derive(Debug, Clone)]
pub struct Thread {
    /// The thread metadata.
    pub row: ThreadRow,
    /// Paginated messages in the thread.
    pub messages: Vec<Message>,
}
