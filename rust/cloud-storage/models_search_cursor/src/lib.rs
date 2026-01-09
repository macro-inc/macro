#![deny(missing_docs)]

//! This crate contains models for the search cursor.

/// Used to store individual cursor information for a given search method.
/// This could be document names, email subject, content etc.
#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct SearchMethodCursor {
    /// The id of the entity, used in tie breakers
    pub entity_id: uuid::Uuid,
    /// The updated at time of the entity
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

/// The search cursor contains all the individual `SearchMethodCursor` for each search method.
#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct SearchCursor {
    /// The document name cursor
    pub document_name_cursor: Option<SearchMethodCursor>,
    /// The chat name cursor
    pub chat_name_cursor: Option<SearchMethodCursor>,
    /// The content cursor
    pub content_cursor: Option<SearchMethodCursor>,
    /// The email subject cursor
    pub email_subject_cursor: Option<SearchMethodCursor>,
    /// The project cursor
    pub project_name_cursor: Option<SearchMethodCursor>,
}
