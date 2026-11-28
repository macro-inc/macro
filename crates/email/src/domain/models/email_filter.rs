use chrono::{DateTime, Utc};
use uuid::Uuid;

/// Maximum number of changed threads sent to the realtime pipeline per filter write.
#[cfg(feature = "outbound")]
pub(crate) const MAX_SENDER_FILTER_THREAD_UPDATES: usize = 250;

/// Outcome of a sender filter write and coverage of its realtime publication.
#[derive(Debug)]
pub struct EmailFilterWrite<T> {
    /// The saved filter, or whether a rule was deleted.
    pub result: T,
    /// More threads changed than could be sent over realtime.
    pub push_was_capped: bool,
}

/// The committed filter change and the thread IDs available for realtime refresh.
#[derive(Debug)]
pub struct EmailFilterChange<T> {
    /// The saved filter, or the outcome of removing it.
    pub result: T,
    /// Only rows whose persisted importance changed, up to the publish limit.
    pub changed_thread_ids: Vec<Uuid>,
    /// Whether the server committed more changes than the publish limit covers.
    pub truncated: bool,
}

#[cfg(feature = "outbound")]
impl<T> EmailFilterChange<T> {
    pub(crate) fn new(result: T, mut changed_thread_ids: Vec<Uuid>) -> Self {
        let truncated = changed_thread_ids.len() > MAX_SENDER_FILTER_THREAD_UPDATES;
        changed_thread_ids.truncate(MAX_SENDER_FILTER_THREAD_UPDATES);
        Self {
            result,
            changed_thread_ids,
            truncated,
        }
    }
}

/// A sender-level importance override rule.
///
/// Each filter targets either an email address or a domain (never both),
/// and marks matching senders as important or not-important.
#[derive(Debug, Clone)]
pub struct EmailFilter {
    /// Database primary key.
    pub id: Uuid,
    /// The email link this filter belongs to.
    pub link_id: Uuid,
    /// Exact email address match (mutually exclusive with `email_domain`).
    pub email_address: Option<String>,
    /// Domain match (mutually exclusive with `email_address`).
    pub email_domain: Option<String>,
    /// Whether matching senders should be considered important.
    pub is_important: bool,
    /// When this filter was created.
    pub created_at: DateTime<Utc>,
}

/// Input for creating or updating an email filter.
#[derive(Debug, Clone)]
pub struct UpsertEmailFilterInput {
    /// Exact email address (mutually exclusive with `email_domain`).
    pub email_address: Option<String>,
    /// Domain (mutually exclusive with `email_address`).
    pub email_domain: Option<String>,
    /// Whether matching senders should be considered important.
    pub is_important: bool,
}
