//! Inbound adapters for the cal.com integration.

pub mod cal_webhook_router;

use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use model_error_response::ErrorResponse;

use crate::domain::models::CalError;

impl IntoResponse for CalError {
    fn into_response(self) -> Response {
        let (status, message): (StatusCode, &str) = match &self {
            CalError::InvalidWebhookSignature => (StatusCode::UNAUTHORIZED, "unauthenticated"),
            CalError::InvalidPayload => {
                tracing::warn!("cal webhook: invalid payload");
                (StatusCode::BAD_REQUEST, "invalid webhook payload")
            }
            // Unsupported events get a 2xx so cal.com doesn't retry them.
            CalError::UnsupportedEvent(_) => return StatusCode::NO_CONTENT.into_response(),
            CalError::Internal(e) => {
                tracing::error!(error=?e, "cal webhook: internal error");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internal server error occurred",
                )
            }
        };

        (
            status,
            Json(ErrorResponse {
                message: message.into(),
            }),
        )
            .into_response()
    }
}
