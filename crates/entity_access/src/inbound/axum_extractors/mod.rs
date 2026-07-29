//! Axum extractors for entity access control.
//!
//! These extractors validate that the requesting user has sufficient
//! access to the entity being accessed.

#[cfg(test)]
mod test;
#[cfg(test)]
mod test_support;

mod bot;
mod call;
mod channel;
mod chat;
mod document;
mod entity_body;
mod entity_permission;
mod foreign_entity;
mod history;
mod pin;
mod project;
mod team;
mod thread;

pub use call::{CallAccessLevelExtractor, CallWithChannelIdAccessLevelExtractor};
pub use channel::ChannelAccessLevelExtractor;
pub use chat::ChatAccessLevelExtractor;
pub use document::DocumentAccessExtractor;
pub use entity_body::EntityBodyAccessLevelExtractor;
pub use entity_permission::EntityPermissionExtractor;
pub use foreign_entity::ForeignEntityAccessLevelExtractor;
pub use history::HistoryAccessExtractor;
pub use pin::PinAccessLevelExtractor;
pub use project::{ProjectAccessLevelExtractor, ProjectBodyAccessLevelExtractorV2};
pub use team::{MacroUserTeamExtractorV2, OptionalMacroUserTeamExtractorV2};
pub use thread::ThreadAccessLevelExtractor;

use std::borrow::Cow;

use crate::domain::models::AccessError;
use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_authorization::MacroAuthorizationRejection;
use model_error_response::ErrorResponse;

pub use crate::domain::models::RequiredPermission;

/// Error type for access extractors that can be returned as HTTP responses.
#[derive(Debug, thiserror::Error)]
pub enum ExtractorError {
    /// User does not have access to the requested resource.
    #[error("User does not have access to the requested resource")]
    Unauthorized,

    /// User credentials were rejected by the authorization service.
    #[error("{message}")]
    Authorization {
        /// HTTP status returned by the authorization extractor.
        status: StatusCode,
        /// Error message returned by the authorization extractor.
        message: Cow<'static, str>,
    },

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

impl From<MacroAuthorizationRejection> for ExtractorError {
    fn from(MacroAuthorizationRejection { status, message }: MacroAuthorizationRejection) -> Self {
        Self::Authorization { status, message }
    }
}

impl IntoResponse for ExtractorError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            ExtractorError::Authorization { status, message } => (status, message),
            error @ (ExtractorError::Unauthorized | ExtractorError::UnauthorizedWithMessage(_)) => {
                (StatusCode::UNAUTHORIZED, error.to_string().into())
            }
            error @ ExtractorError::BadRequest(_) => {
                (StatusCode::BAD_REQUEST, error.to_string().into())
            }
            error @ ExtractorError::NotFound(_) => {
                (StatusCode::NOT_FOUND, error.to_string().into())
            }
            error @ (ExtractorError::Internal | ExtractorError::Database) => {
                (StatusCode::INTERNAL_SERVER_ERROR, error.to_string().into())
            }
        };

        (status, Json(ErrorResponse { message })).into_response()
    }
}
