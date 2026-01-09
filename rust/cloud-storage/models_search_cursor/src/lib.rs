#![deny(missing_docs)]

//! This crate contains models for the search cursor.

use base64::{Engine, engine::general_purpose::STANDARD as BASE64};

/// Used to store individual cursor information for a given search method.
/// This could be document names, email subject, content etc.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SearchMethodCursor {
    /// The id of the entity, used in tie breakers
    pub entity_id: uuid::Uuid,
    /// The updated at time of the entity
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

/// Represents the state of a search cursor
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum SearchCursorOption {
    /// The cursor has either not been started or is not exhausted
    NotDone(Option<SearchMethodCursor>),
    /// The cursor is exhausted
    Done,
}

impl Default for SearchCursorOption {
    fn default() -> Self {
        SearchCursorOption::NotDone(None)
    }
}

impl SearchCursorOption {
    /// Returns true if there are more results to fetch
    pub fn has_more(&self) -> bool {
        matches!(self, SearchCursorOption::NotDone(_))
    }

    /// Returns true if the cursor is exhausted (no more results)
    pub fn is_done(&self) -> bool {
        matches!(self, SearchCursorOption::Done)
    }
}

/// The search cursor contains all the individual `SearchCursorOption` for each search method.
#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct SearchCursor {
    /// The document name cursor
    pub document_name_cursor: SearchCursorOption,
    /// The chat name cursor
    pub chat_name_cursor: SearchCursorOption,
    /// The content cursor
    pub content_cursor: SearchCursorOption,
    /// The email subject cursor
    pub email_subject_cursor: SearchCursorOption,
    /// The project cursor
    pub project_name_cursor: SearchCursorOption,
}

impl SearchCursor {
    /// Decodes a base64-encoded cursor string into a SearchCursor
    pub fn decode(encoded: &str) -> Option<Self> {
        BASE64
            .decode(encoded)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
    }

    /// Encodes the SearchCursor into a base64 string
    pub fn encode(&self) -> Option<String> {
        serde_json::to_vec(self)
            .ok()
            .map(|bytes| BASE64.encode(bytes))
    }
}
