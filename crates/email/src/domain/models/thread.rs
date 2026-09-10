use chrono::{DateTime, Utc};

use super::message::Message;

/// Canonical persisted metadata lazily exposed for an email thread.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct EmailThreadMetadata {
    /// Database ID of the thread.
    pub thread_id: uuid::Uuid,
    /// Canonical email link that owns the thread.
    pub link_id: uuid::Uuid,
    /// Timestamp of the latest inbound message, when one exists.
    pub latest_inbound_message_ts: Option<DateTime<Utc>>,
    /// Canonical ALL-view timestamp before falling back to thread updated_at.
    pub latest_non_spam_message_ts: Option<DateTime<Utc>>,
    /// Whether any message survives the Mail view's TRASH exclusion.
    pub has_non_trashed_messages: bool,
    /// Canonical timestamp used by Sent, independent of the current preview.
    pub latest_outbound_message_ts: Option<DateTime<Utc>>,
    /// Authoritative thread-level calendar-attachment classification.
    pub has_calendar_attachment: bool,
    /// A direct thread share grant through the viewer, team, or active channel.
    /// This is not inferred from the owner or a delegated inbox.
    pub has_thread_share: bool,
    /// Latest non-trashed message for ALL/INBOX/Calendar/Shared.
    pub all_preview: Option<EmailPreview>,
    /// Latest non-trashed draft, even if a newer non-draft exists.
    pub draft_preview: Option<EmailPreview>,
    /// Latest non-trashed sent message.
    pub sent_preview: Option<EmailPreview>,
}

/// Body-free, canonical message data used by Mail list previews.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct EmailPreview {
    /// Global message identity; shared by every preview referencing this message.
    pub id: uuid::Uuid,
    /// Message subject, which need not equal another message's subject in the thread.
    pub subject: Option<String>,
    /// Short text preview, never the full body.
    pub snippet: Option<String>,
    /// Whether this message is a draft.
    pub is_draft: bool,
    /// Sender address.
    pub sender_email: Option<String>,
    /// Sender display name.
    pub sender_name: Option<String>,
    /// Sender profile photo URL.
    pub sender_photo_url: Option<String>,
}

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
    /// The project this thread belongs to, if any.
    pub project_id: Option<String>,
}

/// A fully assembled email thread with paginated messages.
#[derive(Debug, Clone)]
pub struct Thread {
    /// The thread metadata.
    pub row: ThreadRow,
    /// Paginated messages in the thread.
    pub messages: Vec<Message>,
}
