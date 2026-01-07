#![deny(missing_docs)]

//! This crate contains the queries to search over macrodb for your email contacts

use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use sqlx::{Pool, Postgres};

/// Errors for email contact search crate
#[derive(Debug, thiserror::Error)]
pub enum EmailContactSearchError {
    /// Database error
    #[error("database error occurred")]
    DatabaseError(#[from] sqlx::Error),
    /// Empty search term
    #[error("empty search term provided")]
    EmptySearchTerm,
}

/// The contact type for the match
#[derive(Debug, Clone, serde::Serialize)]
pub enum ContactType {
    /// To
    To,
    /// From
    From,
    /// Cc
    Cc,
    /// Bcc
    Bcc,
}

/// Email thread contact match result
#[derive(Debug, Clone, serde::Serialize)]
pub struct EmailContactMatchThreadResult {
    /// The id of the thread
    pub thread_id: uuid::Uuid,
    /// The contact name that was matched on
    pub contact_name: String,
    /// The contact type of the match
    pub contact_type: ContactType,
}

/// Search over your email contacts to find potential contact name matches
#[tracing::instrument(skip(db), err)]
pub async fn search_email_contacts<'a>(
    db: &Pool<Postgres>,
    macro_user_id: MacroUserId<Lowercase<'a>>,
    term: String,
    limit: u32,
    offset: u32,
) -> Result<Vec<EmailContactMatchThreadResult>, EmailContactSearchError> {
    todo!()
}
