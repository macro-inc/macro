//! Domain models for skills.

use chrono::{DateTime, Utc};

/// A skill returned from a skill search.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SkillSummary {
    /// The document id of the skill.
    pub document_id: uuid::Uuid,
    /// The name of the skill.
    pub name: String,
    /// When the skill document was last updated, when known.
    pub updated_at: Option<DateTime<Utc>>,
}

/// How search terms are matched against skill names.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SkillMatchType {
    /// Prefix matching: a single-word term matches tokens that start with it.
    #[default]
    Partial,
    /// Whole-token / exact-phrase matching, no prefix expansion.
    Exact,
}

/// Errors returned by skill operations.
#[derive(Debug, thiserror::Error)]
pub enum SkillError {
    /// The request is invalid.
    #[error("{0}")]
    InvalidRequest(String),
    /// The search backend failed.
    #[error("skill search failed")]
    SearchFailed(#[source] anyhow::Error),
    /// The listing backend failed.
    #[error("skill listing failed")]
    ListFailed(#[source] anyhow::Error),
}
