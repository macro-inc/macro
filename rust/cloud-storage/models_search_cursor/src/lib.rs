#![deny(missing_docs)]

//! This crate contains models for the search cursor.

use base64::{Engine, engine::general_purpose::STANDARD as BASE64};

/// Required trait to be able to create a cursor from a Sortable list of items
pub trait SearchCursorAttributes {
    /// Gets the entity id
    fn entity_id(&self) -> uuid::Uuid;
    /// Gets the updated_at
    fn updated_at(&self) -> chrono::DateTime<chrono::Utc>;
}

/// Result of processing sorted results for pagination
#[derive(Debug, Clone)]
pub struct PaginatedResult<T> {
    /// The items to return (with extra item removed if present)
    pub items: Vec<T>,
    /// The cursor for fetching the next page
    pub cursor: SearchCursorOption,
}

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

    /// Processes sorted results for pagination.
    ///
    /// Expects the query to have fetched `limit + 1` items. Returns the trimmed
    /// items (at most `limit`) and the appropriate cursor.
    pub fn paginate<T: SearchCursorAttributes>(
        mut items: Vec<T>,
        limit: usize,
    ) -> PaginatedResult<T> {
        let has_more = items.len() > limit;
        if has_more {
            items.pop();
        }

        let cursor = if has_more {
            match items.last() {
                Some(last) => SearchCursorOption::NotDone(Some(SearchMethodCursor {
                    entity_id: last.entity_id(),
                    updated_at: last.updated_at(),
                })),
                None => SearchCursorOption::Done,
            }
        } else {
            SearchCursorOption::Done
        };

        PaginatedResult { items, cursor }
    }
}

/// The search cursor contains all the individual `SearchCursorOption` for each search method.
#[derive(Debug, serde::Serialize, serde::Deserialize, Default)]
pub struct SearchCursor {
    /// The document name cursor
    pub document_name_cursor: SearchCursorOption,
    /// The chat name cursor
    pub chat_name_cursor: SearchCursorOption,
    /// The content cursor
    pub content_cursor: SearchCursorOption,
    /// The email subject cursor
    pub email_subject_cursor: SearchCursorOption,
    /// The email contact cursor
    pub email_contact_cursor: SearchCursorOption,
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

    /// Returns if the cursor is fully exhausted
    pub fn is_exhausted(&self) -> bool {
        self.document_name_cursor.is_done()
            && self.chat_name_cursor.is_done()
            && self.content_cursor.is_done()
            && self.email_subject_cursor.is_done()
            && self.email_contact_cursor.is_done()
            && self.project_name_cursor.is_done()
    }
}
