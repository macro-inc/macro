//! HTTP response mapping for chat domain errors.
//!
//! Lives in inbound so the domain error type stays transport-free.

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use entity_access::domain::models::AccessError;

use crate::domain::models::ChatErr;

impl IntoResponse for ChatErr {
    fn into_response(self) -> Response {
        let (status, msg) = match &self {
            ChatErr::NotFound => (StatusCode::NOT_FOUND, "Not found"),
            ChatErr::BadRequest(_) => (StatusCode::BAD_REQUEST, "Bad request"),
            ChatErr::Access(
                AccessError::Unauthorized | AccessError::UnauthorizedWithMessage(_),
            ) => (StatusCode::FORBIDDEN, "Forbidden"),
            ChatErr::Access(AccessError::NotFound(_)) => (StatusCode::NOT_FOUND, "Not found"),
            ChatErr::Access(AccessError::BadRequest(_)) => (StatusCode::BAD_REQUEST, "Bad request"),
            ChatErr::Unknown(_) | ChatErr::Access(_) => {
                tracing::error!(error=?self, "chat handler error");
                (StatusCode::INTERNAL_SERVER_ERROR, "Internal server error")
            }
        };

        (status, msg.to_string()).into_response()
    }
}
