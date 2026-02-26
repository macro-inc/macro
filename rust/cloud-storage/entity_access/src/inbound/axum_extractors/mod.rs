//! Axum extractors for entity access control.
//!
//! These extractors validate that the requesting user has sufficient
//! access to the entity being accessed.

mod chat;
mod document;
mod entity_permission;
mod history;
mod project;
mod thread;

pub use chat::ChatAccessLevelExtractor;
pub use document::DocumentAccessExtractor;
pub use entity_permission::EntityPermissionExtractor;
pub use history::HistoryAccessExtractor;
pub use project::{ProjectAccessLevelExtractor, ProjectBodyAccessLevelExtractor};
pub use thread::ThreadAccessLevelExtractor;

use crate::domain::models::{AccessError, AccessLevel};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use model_error_response::ErrorResponse;

pub use crate::domain::models::RequiredAccessLevel;

/// Marker struct for internal service-to-service requests.
///
/// Middleware inserts this into request extensions for authenticated internal callers.
#[derive(Debug, Clone)]
pub struct InternalUser {
    /// The access level granted to the internal user.
    pub access_level: AccessLevel,
}

/// Error type for access extractors that can be returned as HTTP responses.
#[derive(Debug, thiserror::Error)]
pub enum ExtractorError {
    /// User does not have access to the requested resource.
    #[error("User does not have access to the requested resource")]
    Unauthorized,

    /// User does not have access with a specific message.
    #[error("{0}")]
    UnauthorizedWithMessage(&'static str),

    /// Bad request parameters.
    #[error("Bad request: {0}")]
    BadRequest(&'static str),

    /// Requested resource was not found.
    #[error("Not found: {0}")]
    NotFound(&'static str),

    /// Internal server error.
    #[error("Internal server error")]
    Internal,

    /// Database error.
    #[error("Database error")]
    Database,
}

impl From<AccessError> for ExtractorError {
    fn from(err: AccessError) -> Self {
        match err {
            AccessError::Unauthorized => ExtractorError::Unauthorized,
            AccessError::UnauthorizedWithMessage(msg) => {
                ExtractorError::UnauthorizedWithMessage(msg)
            }
            AccessError::BadRequest(msg) => ExtractorError::BadRequest(msg),
            AccessError::NotFound(msg) => ExtractorError::NotFound(msg),
            AccessError::DatabaseError(_) => ExtractorError::Database,
            AccessError::Internal => ExtractorError::Internal,
        }
    }
}

impl IntoResponse for ExtractorError {
    fn into_response(self) -> Response {
        let (status, message) = match &self {
            ExtractorError::Unauthorized => (StatusCode::UNAUTHORIZED, self.to_string()),
            ExtractorError::UnauthorizedWithMessage(_) => {
                (StatusCode::UNAUTHORIZED, self.to_string())
            }
            ExtractorError::BadRequest(_) => (StatusCode::BAD_REQUEST, self.to_string()),
            ExtractorError::NotFound(_) => (StatusCode::NOT_FOUND, self.to_string()),
            ExtractorError::Internal | ExtractorError::Database => {
                (StatusCode::INTERNAL_SERVER_ERROR, self.to_string())
            }
        };

        let error_response = ErrorResponse { message: &message };
        (status, axum::Json(error_response)).into_response()
    }
}
