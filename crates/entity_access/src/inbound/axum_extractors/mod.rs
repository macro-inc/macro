//! Axum extractors for entity access control.
//!
//! These extractors validate that the requesting user has sufficient
//! access to the entity being accessed.

mod call;
mod channel;
mod chat;
mod document;
mod entity_permission;
mod foreign_entity;
mod history;
mod pin;
mod project;
mod team;
mod thread;

#[cfg(test)]
mod test;

pub use call::{CallAccessLevelExtractor, CallWithChannelIdAccessLevelExtractor};
pub use channel::ChannelAccessLevelExtractor;
pub use chat::ChatAccessLevelExtractor;
pub use document::DocumentAccessExtractor;
pub use entity_permission::EntityPermissionExtractor;
pub use foreign_entity::ForeignEntityAccessLevelExtractor;
pub use history::HistoryAccessExtractor;
pub use pin::PinAccessLevelExtractor;
pub use project::{ProjectAccessLevelExtractor, ProjectBodyAccessLevelExtractor};
pub use team::{MacroUserTeamExtractor, OptionalMacroUserTeamExtractor};
pub use thread::ThreadAccessLevelExtractor;

use crate::domain::models::{AccessError, AccessLevel};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use macro_authorization::MacroAuthorizationRejection;
use model_error_response::ErrorResponse;

pub use crate::domain::models::RequiredPermission;

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
    /// Request credentials could not authorize a user.
    #[error(transparent)]
    Credential(#[from] MacroAuthorizationRejection),

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
        let error = match self {
            ExtractorError::Credential(error) => return error.into_response(),
            error => error,
        };

        let (status, message) = match &error {
            ExtractorError::Unauthorized => (StatusCode::UNAUTHORIZED, error.to_string()),
            ExtractorError::UnauthorizedWithMessage(_) => {
                (StatusCode::UNAUTHORIZED, error.to_string())
            }
            ExtractorError::BadRequest(_) => (StatusCode::BAD_REQUEST, error.to_string()),
            ExtractorError::NotFound(_) => (StatusCode::NOT_FOUND, error.to_string()),
            ExtractorError::Internal | ExtractorError::Database => {
                (StatusCode::INTERNAL_SERVER_ERROR, error.to_string())
            }
            ExtractorError::Credential(_) => unreachable!("credential errors return above"),
        };

        let error_response = ErrorResponse {
            message: message.into(),
        };
        (status, axum::Json(error_response)).into_response()
    }
}
