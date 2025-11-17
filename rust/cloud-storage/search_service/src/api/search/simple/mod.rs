use crate::api::ApiContext;
use axum::{
    Json, Router,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
};
use model::response::ErrorResponse;
use opensearch_client::error::OpensearchClientError;

pub(in crate::api) mod simple_channel;
pub(in crate::api) mod simple_chat;
pub(in crate::api) mod simple_document;
pub(in crate::api) mod simple_email;
pub(in crate::api) mod simple_project;
pub(in crate::api) mod simple_unified;

pub fn router() -> Router<ApiContext> {
    Router::new()
        .route("/", post(simple_unified::handler))
        .route("/document", post(simple_document::handler))
        .route("/chat", post(simple_chat::handler))
        .route("/email", post(simple_email::handler))
        .route("/channel", post(simple_channel::handler))
        .route("/project", post(simple_project::handler))
}

#[derive(thiserror::Error, Debug)]
pub enum SearchError {
    /// No user id found in user context
    #[error("no user id found in user context")]
    NoUserId,
    /// Invalid page size
    #[error("page_size must be between 0 and 100")]
    InvalidPageSize,
    /// Invalid query size
    #[error("query must be at least 3 characters")]
    InvalidQuerySize,
    /// No query or terms provided
    #[error("query or terms must be provided")]
    NoQueryOrTermsProvided,
    /// Opensearch error occurred
    #[error("unable to search: {0}")]
    Search(#[from] OpensearchClientError),
    /// Internal error occurred
    #[error("internal error: {0}")]
    InternalError(#[from] anyhow::Error),
}

impl IntoResponse for SearchError {
    fn into_response(self) -> Response {
        let (status_code, message) = match &self {
            SearchError::NoUserId => (StatusCode::UNAUTHORIZED, self.to_string()),
            SearchError::InvalidPageSize
            | SearchError::InvalidQuerySize
            | SearchError::NoQueryOrTermsProvided => (StatusCode::BAD_REQUEST, self.to_string()),
            SearchError::Search(e) => {
                tracing::error!("Search error details: {:?}", e);
                (StatusCode::INTERNAL_SERVER_ERROR, self.to_string())
            }
            SearchError::InternalError(e) => {
                tracing::error!("Internal error details: {:?}", e);
                (StatusCode::INTERNAL_SERVER_ERROR, self.to_string())
            }
        };

        (
            status_code,
            Json(ErrorResponse {
                message: message.as_str(),
            }),
        )
            .into_response()
    }
}
