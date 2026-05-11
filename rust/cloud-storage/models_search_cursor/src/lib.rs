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

/// Cursor for a single search method. Each variant matches the sort fields
/// of the search it paginates, so the values can be passed straight to
/// OpenSearch's `search_after` without re-purposing.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub enum SearchMethodCursor {
    /// Sort: `[updated_at_ms desc, entity_id asc]`. Used by name searches and
    /// the default channel content sort.
    UpdatedAt {
        /// Tiebreaker entity id.
        entity_id: uuid::Uuid,
        /// Primary sort timestamp.
        updated_at: chrono::DateTime<chrono::Utc>,
    },
    /// Sort: `[thread_id desc, message_id desc]`. Used by channel content
    /// search in thread-grouped mode.
    Thread {
        /// Primary sort key.
        thread_id: uuid::Uuid,
        /// Tiebreaker for replies within the same thread.
        message_id: uuid::Uuid,
    },
}

impl SearchMethodCursor {
    /// Produces the values to pass as OpenSearch `search_after`.
    pub fn search_after(&self) -> Vec<serde_json::Value> {
        match self {
            Self::UpdatedAt {
                entity_id,
                updated_at,
            } => vec![
                serde_json::json!(updated_at.timestamp_millis()),
                serde_json::json!(entity_id.to_string()),
            ],
            Self::Thread {
                thread_id,
                message_id,
            } => vec![
                serde_json::json!(thread_id.to_string()),
                serde_json::json!(message_id.to_string()),
            ],
        }
    }

    /// Returns `(entity_id, updated_at)` for the `UpdatedAt` variant.
    /// Callers that only paginate by `(updated_at, entity_id)` use this to
    /// avoid exhaustive matching; `Thread` cursors yield `None`.
    pub fn as_updated_at(&self) -> Option<(uuid::Uuid, chrono::DateTime<chrono::Utc>)> {
        match self {
            Self::UpdatedAt {
                entity_id,
                updated_at,
            } => Some((*entity_id, *updated_at)),
            Self::Thread { .. } => None,
        }
    }

    /// Encodes the cursor as a base64 string for client transport.
    pub fn encode(&self) -> Option<String> {
        serde_json::to_vec(self)
            .ok()
            .map(|bytes| BASE64.encode(bytes))
    }

    /// Decodes a base64-encoded cursor string.
    pub fn decode(encoded: &str) -> Option<Self> {
        BASE64
            .decode(encoded)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
    }
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
                Some(last) => SearchCursorOption::NotDone(Some(SearchMethodCursor::UpdatedAt {
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
            && self.project_name_cursor.is_done()
    }
}
