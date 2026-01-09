#![deny(missing_docs)]
//! This crate contains queries to search over macro db entities by their name

mod chat;
mod document;
mod email;
mod project;

pub use chat::*;
pub use document::*;
pub use email::*;
pub use models_opensearch::SearchEntityType;
pub use project::*;

/// Errors for name search crate
#[derive(Debug, thiserror::Error)]
pub enum NameSearchError {
    /// Database error
    #[error("database error occurred")]
    DatabaseError(#[from] sqlx::Error),
    /// Empty search term
    #[error("empty search term provided")]
    EmptySearchTerm,
    /// Empty ids provided with ids only set to true
    #[error("empty ids provided with ids only set to true")]
    EmptyIdsWithIdsOnly,
}

/// Name search result match
#[derive(Debug, Clone, serde::Serialize)]
pub struct NameSearchResult {
    /// The id of the entity
    pub entity_id: uuid::Uuid,
    /// The type of the entity
    pub entity_type: SearchEntityType,
    /// The name that was matched
    pub name: String,
}
