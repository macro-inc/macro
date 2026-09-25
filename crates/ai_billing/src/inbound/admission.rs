//! Public admission failures shared by HTTP endpoints and structured tool errors.

use crate::domain::AiAdmissionError;
use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde::Serialize;
use utoipa::ToSchema;

#[cfg(test)]
mod test;

/// A public admission failure, without payer or internal diagnostic details.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
pub struct AiAdmissionErrorBody {
    /// Human-readable explanation and recovery guidance.
    pub error: &'static str,
    /// Stable code distinguishing quota denials from retryable billing failures.
    pub code: &'static str,
}

impl From<&AiAdmissionError> for AiAdmissionErrorBody {
    fn from(error: &AiAdmissionError) -> Self {
        match error {
            AiAdmissionError::Denied(reason) => Self {
                error: reason.message(),
                code: error.code(),
            },
            AiAdmissionError::Unavailable(_) => Self {
                error: "AI billing is unavailable. Please try again.",
                code: error.code(),
            },
        }
    }
}

/// Map an admission failure to HTTP while keeping diagnostic reports private.
/// Callers with additional response fields can reuse the status and JSON body.
pub fn admission_error_response(
    error: &AiAdmissionError,
) -> (StatusCode, Json<AiAdmissionErrorBody>) {
    let status = match error {
        AiAdmissionError::Denied(_) => StatusCode::PAYMENT_REQUIRED,
        AiAdmissionError::Unavailable(_) => StatusCode::SERVICE_UNAVAILABLE,
    };
    (status, Json(AiAdmissionErrorBody::from(error)))
}

impl IntoResponse for AiAdmissionError {
    fn into_response(self) -> Response {
        admission_error_response(&self).into_response()
    }
}
