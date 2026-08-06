use chrono::{DateTime, Utc};
use models_email::email::service::thread::ThreadSummary;
use serde::{Deserialize, Serialize};

use super::SyncCursor;

/// Provider-neutral calendar invitation part discovered in a message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CalendarPart {
    /// Provider MIME-part identifier, when available.
    pub part_id: Option<String>,
    /// Original filename, when supplied by the sender.
    pub filename: Option<String>,
    /// Declared media type.
    pub mime_type: String,
    /// Decoded inline bytes, if the provider included the part inline.
    pub inline_data: Option<Vec<u8>>,
    /// Provider attachment identifier when a separate download is required.
    pub provider_attachment_id: Option<String>,
}

/// An active provider notification subscription and its synchronization cursor.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProviderSubscription {
    /// Cursor identifying provider state when the subscription was created.
    pub cursor: SyncCursor,
    /// Instant at which the provider expires the subscription.
    pub expires_at: DateTime<Utc>,
}

impl ProviderSubscription {
    /// Creates a provider subscription.
    pub fn new(cursor: SyncCursor, expires_at: DateTime<Utc>) -> Self {
        Self { cursor, expires_at }
    }

    /// Returns whether the subscription has expired at `now`.
    pub fn is_expired_at(&self, now: DateTime<Utc>) -> bool {
        self.expires_at <= now
    }
}

/// One provider page of email thread identifiers.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThreadListPage {
    /// Threads returned in this page.
    pub threads: Vec<ThreadSummary>,
    /// Opaque token for the next page, or `None` when this is the last page.
    pub next_page_token: Option<String>,
}
