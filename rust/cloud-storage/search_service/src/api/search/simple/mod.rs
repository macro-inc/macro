use crate::api::context::SearchHandlerState;
use axum::{
    Json, Router,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
};
use email_contact_search::EmailContactSearchError;
use model::response::ErrorResponse;
use name_search::NameSearchError;
use opensearch_client::error::OpensearchClientError;

pub(in crate::api) mod filter;
pub(in crate::api) mod simple_channel;
pub(in crate::api) mod simple_chat;
pub(in crate::api) mod simple_document;
pub(in crate::api) mod simple_email;
pub(in crate::api) mod simple_project;
pub mod simple_unified;

pub fn router() -> Router<SearchHandlerState> {
    Router::new().route("/", post(simple_unified::handler))
}

#[derive(thiserror::Error, Debug)]
pub enum SearchError {
    /// No user id found in user context
    #[error("no user id found in user context")]
    NoUserId,
    /// Invalid macro user id
    #[error("invalid macro user id {0}")]
    InvalidUserId(String),
    /// Invalid page size
    #[error("page_size must be between 0 and 100")]
    InvalidPageSize,
    /// Invalid query size
    #[error("query must be at least 3 characters")]
    InvalidQuerySize,
    /// No query or terms provided
    #[error("query or terms must be provided and at least 3 characters")]
    NoQueryOrTermsProvided,
    #[error("searching with an invalid cursor")]
    /// Searching with an invalid cursor
    InvalidCursor,
    /// Opensearch error occurred
    #[error("unable to search")]
    Search(#[from] OpensearchClientError),
    /// Name search error occurred
    #[error("unable to name search")]
    NameSearch(#[from] NameSearchError),
    /// Email contact search error occurred
    #[error("unable to search email contacts")]
    EmailContactSearch(#[from] EmailContactSearchError),
    /// Internal error occurred
    #[error("internal error")]
    InternalError(#[from] anyhow::Error),
}

impl IntoResponse for SearchError {
    fn into_response(self) -> Response {
        let status_code = match self {
            SearchError::NoUserId | SearchError::InvalidUserId(_) => StatusCode::UNAUTHORIZED,
            SearchError::InvalidPageSize
            | SearchError::InvalidQuerySize
            | SearchError::InvalidCursor
            | SearchError::NoQueryOrTermsProvided => StatusCode::BAD_REQUEST,
            SearchError::Search(_)
            | SearchError::NameSearch(_)
            | SearchError::EmailContactSearch(_)
            | SearchError::InternalError(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        (
            status_code,
            Json(ErrorResponse {
                message: self.to_string().into(),
            }),
        )
            .into_response()
    }
}
