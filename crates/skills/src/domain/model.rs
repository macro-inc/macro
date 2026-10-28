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
    /// The skill could not be read.
    #[error("skill reading failed")]
    ReadFailed(#[source] anyhow::Error),
    /// The caller cannot view the skill document.
    #[error("skill not found or access denied")]
    AccessDenied(#[source] entity_access::domain::models::AccessError),
    /// The requested document is not an active markdown skill.
    #[error("document is not an active skill; use ListSkills to find skills")]
    NotASkill,
    /// The search backend failed.
    #[error("skill search failed")]
    SearchFailed(#[source] anyhow::Error),
    /// The listing backend failed.
    #[error("skill listing failed")]
    ListFailed(#[source] anyhow::Error),
}

/// A skill's complete instructions, independent of the agent harness.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SkillContent {
    /// The skill document id, or built-in system skill id.
    pub document_id: uuid::Uuid,
    /// The skill's display name.
    pub name: String,
    /// The full markdown instructions to follow for the invoking request.
    pub content: String,
}

/// Document facts used to decide whether it can be read as a skill.
#[derive(Debug, Clone)]
pub struct SkillDocumentMetadata {
    /// The document's display name.
    pub name: String,
    /// The document subtype.
    pub sub_type: Option<document_sub_type::DocumentSubType>,
    /// The document's file type.
    pub file_type: Option<String>,
    /// Whether the document has been deleted.
    pub deleted: bool,
}
