//! Identity-checked, insert-only reconstruction of the pull request index.

use chrono::{DateTime, Utc};
use uuid::Uuid;

/// One stored source record, before identity validation or sparse-field merging.
#[derive(Debug, Clone)]
pub struct PullRequestIndexRecord {
    /// Stable record ID used to order equal source update times.
    pub id: Uuid,
    /// Source namespace of the stored record.
    pub source: String,
    /// Association key on the stored record, independent of its metadata.
    pub github_key: String,
    /// Source record update time, not evidence of repository identity.
    pub updated_at: DateTime<Utc>,
    /// Supplied PR fields, retaining omitted-versus-empty distinctions.
    pub metadata: serde_json::Value,
}

/// Result of atomically initializing a verified typed row without updating existing rows.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PullRequestIndexOutcome {
    /// A previously missing row was inserted.
    Inserted,
    /// The same case-insensitive key and stable identity already exist; nothing changed.
    AlreadyPresent,
    /// A key or stable identity belongs to a different or unverified row; nothing changed.
    IdentityConflict,
}

/// Outcomes across repositories. Expected legacy skips are not storage failures.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct PullRequestIndexSummary {
    /// Typed PR rows newly inserted, excluding retries and existing rows.
    pub inserted: u64,
    /// Initialization attempts that found an existing matching typed row.
    pub already_present: u64,
    /// Source records omitted because they do not carry a repository ID.
    pub unverified_records: u64,
    /// Malformed source records, invalid keys, or invalid numeric identities.
    pub invalid_records: u64,
    /// Source records or initialization attempts rejected for conflicting identity.
    pub identity_conflicts: u64,
    /// Repository reads, invalid installation repository identities, or row writes that failed.
    pub failures: u64,
}

impl PullRequestIndexSummary {
    /// Whether the batch needs investigation or retry, excluding expected unverified skips.
    pub fn has_failures(&self) -> bool {
        self.failures > 0 || self.identity_conflicts > 0 || self.invalid_records > 0
    }
}
