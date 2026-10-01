//! Sanitized HTTP contract for AI admission failures.

use crate::AiAdmissionError;
use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Serialize;
use utoipa::ToSchema;

#[cfg(test)]
mod test;

/// Public admission error payload. Handlers with additional fields can reuse the
/// domain error's code and message and [`admission_status`].
#[derive(Debug, Serialize, ToSchema)]
pub struct AiAdmissionErrorBody {
    /// Human-readable explanation, without internal billing diagnostics.
    pub error: String,
    /// Stable denial or unavailability code.
    pub code: String,
}

/// Map policy refusals to 402 and retryable validation failures to 503.
pub fn admission_status(error: AiAdmissionError) -> StatusCode {
    match error {
        AiAdmissionError::Denied(_) => StatusCode::PAYMENT_REQUIRED,
        AiAdmissionError::Unavailable => StatusCode::SERVICE_UNAVAILABLE,
    }
}

impl IntoResponse for AiAdmissionError {
    fn into_response(self) -> Response {
        (
            admission_status(self),
            Json(AiAdmissionErrorBody {
                error: self.to_string(),
                code: self.code().to_string(),
            }),
        )
            .into_response()
    }
}
