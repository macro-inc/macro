use crate::api::context::SearchHandlerState;
use axum::{
    Json, Router,
    http::{StatusCode, header},
    response::{IntoResponse, Response},
    routing::post,
};
use model::response::ErrorResponse;
use name_search::NameSearchError;
use opensearch_client::error::OpensearchClientError;

pub(in crate::api) mod filter;
mod filter_expression;
pub(in crate::api) mod simple_calendar_event;
pub(in crate::api) mod simple_call_record;
pub(in crate::api) mod simple_channel;
pub(in crate::api) mod simple_chat;
pub(in crate::api) mod simple_document;
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
    /// The endpoint only accepts internal service authentication.
    #[error("internal access required")]
    InternalAccessRequired,
    /// Invalid macro user id
    #[error("invalid macro user id {0}")]
    InvalidUserId(String),
    /// Invalid page size
    #[error("page_size must be between 0 and 100")]
    InvalidPageSize,
    /// The additional filter expression is invalid or cannot be indexed faithfully.
    #[error("unsupported or invalid search filter expression")]
    InvalidFilterExpression,
    /// The query holds no search term
    #[error("query must not be empty")]
    EmptyQuery,
    /// Query expands into too many search terms
    #[error("query has too many terms (max 50)")]
    TooManyTerms,
    /// No query or terms provided
    #[error("query or terms must be provided")]
    NoQueryOrTermsProvided,
    /// No channel IDs provided
    #[error("at least one channel_id must be provided")]
    NoChannelIds,
    #[error("searching with an invalid cursor")]
    /// Searching with an invalid cursor
    InvalidCursor,
    /// A CRM company filter id was not a valid UUID
    #[error("invalid crm company id: {0}")]
    InvalidCrmCompanyId(String),
    /// An agent-session filter is not a UUID.
    #[error("invalid agent session id: {0}")]
    InvalidAgentSessionId(String),
    /// A channel filter id is not a UUID.
    #[error("invalid channel id: {0}")]
    InvalidChannelId(String),
    /// A channel type filter is not a known channel type.
    #[error("invalid channel type: {0}")]
    InvalidChannelType(String),
    /// An email filter search cannot apply, rejected rather than ignored
    #[error("email_filters.{0} is not supported by search")]
    UnsupportedEmailFilter(&'static str),
    /// Too many Drive folders in one email search
    #[error("email_filters.project_ids takes at most {0} folders")]
    TooManyEmailProjects(usize),
    /// The caller's other searches held every slot of its lane until the wait
    /// ran out
    #[error("too many of your searches are running at once; retry with fewer at once")]
    Busy,
    /// The account's user API keys used their search allowance
    #[error(
        "search rate limit reached for this account's API keys; retry after {retry_after_seconds}s"
    )]
    RateLimited { retry_after_seconds: u64 },
    /// Opensearch error occurred
    #[error("unable to search")]
    Search(#[from] OpensearchClientError),
    /// Name search error occurred
    #[error("unable to name search")]
    NameSearch(#[from] NameSearchError),
    /// Internal error occurred
    #[error("internal error")]
    InternalError(#[from] anyhow::Error),
}

/// How soon a caller refused as busy may search again: by then one of its
/// running searches has usually finished.
const BUSY_RETRY_AFTER_SECONDS: &str = "1";

impl IntoResponse for SearchError {
    fn into_response(self) -> Response {
        let status_code = match self {
            SearchError::NoUserId
            | SearchError::InternalAccessRequired
            | SearchError::InvalidUserId(_) => StatusCode::UNAUTHORIZED,
            SearchError::InvalidPageSize
            | SearchError::InvalidFilterExpression
            | SearchError::EmptyQuery
            | SearchError::TooManyTerms
            | SearchError::InvalidCursor
            | SearchError::InvalidCrmCompanyId(_)
            | SearchError::InvalidAgentSessionId(_)
            | SearchError::InvalidChannelId(_)
            | SearchError::InvalidChannelType(_)
            | SearchError::UnsupportedEmailFilter(_)
            | SearchError::TooManyEmailProjects(_)
            | SearchError::NoQueryOrTermsProvided
            | SearchError::NoChannelIds => StatusCode::BAD_REQUEST,
            SearchError::NameSearch(NameSearchError::IncompatibleCursor) => StatusCode::BAD_REQUEST,
            SearchError::Busy | SearchError::RateLimited { .. } => StatusCode::TOO_MANY_REQUESTS,
            SearchError::Search(_) | SearchError::NameSearch(_) | SearchError::InternalError(_) => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
        };

        let retry_after = match &self {
            SearchError::Busy => Some(BUSY_RETRY_AFTER_SECONDS.to_string()),
            SearchError::RateLimited {
                retry_after_seconds,
            } => Some(retry_after_seconds.to_string()),
            _ => None,
        };
        let body = Json(ErrorResponse {
            message: self.to_string().into(),
        });
        match retry_after {
            Some(seconds) => (status_code, [(header::RETRY_AFTER, seconds)], body).into_response(),
            None => (status_code, body).into_response(),
        }
    }
}
