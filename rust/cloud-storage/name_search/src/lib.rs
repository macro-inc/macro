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
use models_search_cursor::{PaginatedResult, SearchCursorAttributes};
pub use project::*;

/// Escapes special regex characters in a search term
pub(crate) fn escape_regex(term: &str) -> String {
    let special_chars = [
        '\\', '.', '+', '*', '?', '(', ')', '[', ']', '{', '}', '^', '$', '|',
    ];
    let mut escaped = String::with_capacity(term.len() * 2);
    for c in term.chars() {
        if special_chars.contains(&c) {
            escaped.push('\\');
        }
        escaped.push(c);
    }
    escaped
}

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
    /// The timestamp used for cursor-based pagination
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

impl SearchCursorAttributes for NameSearchResult {
    fn entity_id(&self) -> uuid::Uuid {
        self.entity_id
    }

    fn updated_at(&self) -> chrono::DateTime<chrono::Utc> {
        self.updated_at
    }
}
