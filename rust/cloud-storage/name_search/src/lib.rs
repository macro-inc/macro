#![deny(missing_docs)]
//! This crate contains queries to search over macro db entities by their name

mod chat;
mod document;
mod project;

pub use chat::*;
pub use document::*;
pub use models_opensearch::SearchEntityType;
use models_search_cursor::{PaginatedResult, SearchCursorAttributes};
pub use project::*;

/// Escapes special regex characters in a search term
pub fn escape_regex(term: &str) -> String {
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

/// Applies the same `<macro_em>` name-highlight replacement that the Postgres
/// name-search queries apply via `regexp_replace(..., 'gi')`, but against an
/// in-memory name string. Returns `None` when the term is empty or the name
/// does not contain the term (case-insensitive).
pub fn highlight_name(name: &str, term: &str) -> Option<String> {
    let term = term.trim();
    if term.is_empty() {
        return None;
    }
    let re = regex::Regex::new(&format!("(?i)({})", escape_regex(term))).ok()?;
    if !re.is_match(name) {
        return None;
    }
    Some(re.replace_all(name, "<macro_em>$1</macro_em>").into_owned())
}

#[cfg(test)]
mod highlight_test {
    use super::highlight_name;

    #[test]
    fn returns_none_for_empty_term() {
        assert!(highlight_name("testingfoop", "").is_none());
        assert!(highlight_name("testingfoop", "   ").is_none());
    }

    #[test]
    fn returns_none_when_name_does_not_match() {
        assert!(highlight_name("unrelated", "test").is_none());
    }

    #[test]
    fn wraps_substring_matches_case_insensitively() {
        assert_eq!(
            highlight_name("testingfoop", "test").as_deref(),
            Some("<macro_em>test</macro_em>ingfoop")
        );
        assert_eq!(
            highlight_name("MD CHECKBOX LIST TEST", "test").as_deref(),
            Some("MD CHECKBOX LIST <macro_em>TEST</macro_em>")
        );
    }

    #[test]
    fn wraps_all_occurrences() {
        assert_eq!(
            highlight_name("test of a test", "test").as_deref(),
            Some("<macro_em>test</macro_em> of a <macro_em>test</macro_em>")
        );
    }

    #[test]
    fn escapes_regex_specials_in_term() {
        assert_eq!(
            highlight_name("plan (v2) draft", "(v2)").as_deref(),
            Some("plan <macro_em>(v2)</macro_em> draft")
        );
    }
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
