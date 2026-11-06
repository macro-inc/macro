//! HTTP adapter for the general Jev named-decision use case.

use super::context::{ApiContext, DcsAuthorizationService};
use ai_billing::inbound::admission::admission_status;
use axum::{
    Json,
    extract::{State, rejection::JsonRejection},
    http::StatusCode,
    response::IntoResponse,
    routing::{MethodRouter, post},
};
use jev::domain::{
    DecisionRequest, DecisionResponse, JevError, MAX_DECISION_REQUEST_BYTES,
    decisions::DecisionError,
};
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use serde::Serialize;
use tower_http::limit::RequestBodyLimitLayer;
use utoipa::ToSchema;

#[cfg(test)]
mod test;

/// Sanitized, machine-readable failure of a decision request.
#[derive(Debug, Serialize, ToSchema, thiserror::Error)]
#[error("{error}")]
pub struct DecisionErrorBody {
    /// Human-readable explanation without provider credentials or diagnostics.
    pub error: String,
    /// Stable failure code.
    pub code: String,
    #[serde(skip)]
    status: StatusCode,
}

impl From<DecisionError> for DecisionErrorBody {
    fn from(error: DecisionError) -> Self {
        let (status, code) = match error {
            DecisionError::InvalidRequest(_) => {
                (StatusCode::BAD_REQUEST, "invalid_decision_request")
            }
            DecisionError::Admission(admission) => (admission_status(admission), admission.code()),
            DecisionError::Unavailable | DecisionError::Provider(JevError::Unavailable) => {
                (StatusCode::SERVICE_UNAVAILABLE, "decisions_unavailable")
            }
            DecisionError::Busy => (StatusCode::SERVICE_UNAVAILABLE, "decisions_busy"),
            DecisionError::Timeout => (StatusCode::GATEWAY_TIMEOUT, "decision_timeout"),
            DecisionError::Provider(_) => (StatusCode::BAD_GATEWAY, "decision_provider_error"),
            DecisionError::Failed => (StatusCode::INTERNAL_SERVER_ERROR, "decision_failed"),
        };
        Self {
            error: error.to_string(),
            code: code.to_owned(),
            status,
        }
    }
}

impl IntoResponse for DecisionErrorBody {
    fn into_response(self) -> axum::response::Response {
        (self.status, Json(self)).into_response()
    }
}

pub(super) fn route() -> MethodRouter<ApiContext> {
    // Allow whitespace in JSON while bounding deserialization. The domain
    // independently enforces the compact 64 KiB request contract for all callers.
    post(decide).layer(RequestBodyLimitLayer::new(MAX_DECISION_REQUEST_BYTES * 2))
}

#[utoipa::path(
    post,
    path = "/decisions",
    operation_id = "decisions",
    request_body = DecisionRequest,
    responses(
        (status = 200, description = "Probability of yes for each named question", body = DecisionResponse),
        (status = 400, description = "Invalid or oversized compact request", body = DecisionErrorBody),
        (status = 401, description = "Unauthorized"),
        (status = 402, description = "AI allowance exhausted", body = DecisionErrorBody),
        (status = 413, description = "HTTP body exceeds 128 KiB"),
        (status = 500, description = "Decision task failed", body = DecisionErrorBody),
        (status = 502, description = "Classifier could not produce a valid result", body = DecisionErrorBody),
        (status = 503, description = "Decision capacity, provider, or usage validation unavailable", body = DecisionErrorBody),
        (status = 504, description = "Decision deadline exceeded", body = DecisionErrorBody),
    )
)]
#[tracing::instrument(skip_all, err)]
pub async fn decide(
    State(state): State<ApiContext>,
    user: MacroAuthorizationExtractor<DcsAuthorizationService, UserOrInternal>,
    request: Result<Json<DecisionRequest>, JsonRejection>,
) -> Result<Json<DecisionResponse>, DecisionErrorBody> {
    let Json(request) = request.map_err(|error| DecisionErrorBody {
        error: "expected JSON with input and named questions, within the request size limit"
            .to_owned(),
        code: "invalid_decision_request".to_owned(),
        status: if error.status() == StatusCode::PAYLOAD_TOO_LARGE {
            StatusCode::PAYLOAD_TOO_LARGE
        } else {
            StatusCode::BAD_REQUEST
        },
    })?;
    state
        .decisions
        .decide(user.authorization.user.macro_user_id.clone(), request)
        .await
        .map(Json)
        .map_err(DecisionErrorBody::from)
}
