use chrono::{DateTime, Utc};

/// Mail-specific read model used to hydrate offline list projections.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EmailThreadMailProjection {
    /// Database ID of the projected thread.
    pub thread_id: uuid::Uuid,
    /// Server-only facts used by the offline Mail predicate index.
    pub cache_facts: EmailThreadMailCacheFacts,
    /// Canonical body-free previews used to materialize each Mail tab.
    pub previews: EmailThreadMailPreviews,
}

/// Server-only facts used to filter and order cached Mail threads.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EmailThreadMailCacheFacts {
    /// Canonical ALL-view timestamp before falling back to thread `updated_at`.
    pub latest_non_spam_message_ts: Option<DateTime<Utc>>,
    /// Canonical SENT-view timestamp.
    pub latest_outbound_message_ts: Option<DateTime<Utc>>,
    /// Authoritative thread-level calendar-attachment classification.
    pub has_calendar_attachment: bool,
    /// Direct share grant through the viewer, a team, or an active channel.
    pub has_thread_share: bool,
}

/// Canonical body-free preview choices for each Mail tab.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EmailThreadMailPreviews {
    /// Latest non-trashed message for ALL, INBOX, Calendar, and Shared.
    pub all: Option<EmailPreview>,
    /// Latest non-trashed draft, even if a newer non-draft exists.
    pub draft: Option<EmailPreview>,
    /// Latest non-trashed sent message.
    pub sent: Option<EmailPreview>,
}

/// Body-free canonical message data used by Mail list previews.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct EmailPreview {
    /// Global message identity, shared by every preview referencing this message.
    pub id: uuid::Uuid,
    /// Message subject.
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
