use chrono::{DateTime, Utc};
use uuid::Uuid;

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
