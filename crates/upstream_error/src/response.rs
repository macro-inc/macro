use axum::{
    Json,
    http::{HeaderValue, StatusCode, header::RETRY_AFTER},
    response::{IntoResponse, Response},
};

use crate::{UpstreamError, UpstreamFailure};

/// What kind of upstream failure a 502 or 503 reports, for clients that
/// branch on it.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize, utoipa::ToSchema,
)]
#[serde(rename_all = "snake_case")]
pub enum UpstreamErrorCode {
    /// The provider is down or timed out. Retry later.
    UpstreamUnavailable,
    /// The provider is throttling requests. Retry after `Retry-After`.
    UpstreamRateLimited,
    /// The provider answered with something unusable. Retry later.
    UpstreamInvalidResponse,
}

/// The body of a 502 or 503 caused by a third-party service.
#[derive(Debug, serde::Serialize, serde::Deserialize, utoipa::ToSchema)]
pub struct UpstreamErrorResponse {
    /// What failed and what to do about it, written for the user.
    pub message: String,
    /// The kind of failure.
    pub code: UpstreamErrorCode,
}

impl UpstreamError {
    /// 503 when retrying later can help, 502 when the provider's answer was
    /// unusable.
    pub fn status_code(&self) -> StatusCode {
        match self.failure {
            UpstreamFailure::Unavailable | UpstreamFailure::RateLimited { .. } => {
                StatusCode::SERVICE_UNAVAILABLE
            }
            UpstreamFailure::InvalidResponse => StatusCode::BAD_GATEWAY,
        }
    }

    /// The response body: a message the client can show, and its code.
    pub fn body(&self) -> UpstreamErrorResponse {
        let service = self.service;
        let (code, message) = match self.failure {
            UpstreamFailure::Unavailable => (
                UpstreamErrorCode::UpstreamUnavailable,
                format!("{service} is temporarily unavailable. Try again in a few minutes."),
            ),
            UpstreamFailure::RateLimited { .. } => (
                UpstreamErrorCode::UpstreamRateLimited,
                format!("{service} is limiting requests right now. Try again shortly."),
            ),
            UpstreamFailure::InvalidResponse => (
                UpstreamErrorCode::UpstreamInvalidResponse,
                format!("{service} returned an unexpected response. Try again in a few minutes."),
            ),
        };
        UpstreamErrorResponse { message, code }
    }
}

impl IntoResponse for UpstreamError {
    fn into_response(self) -> Response {
        let mut response = (self.status_code(), Json(self.body())).into_response();
        if let UpstreamFailure::RateLimited {
            retry_after: Some(retry_after),
        } = self.failure
        {
            response
                .headers_mut()
                .insert(RETRY_AFTER, HeaderValue::from(retry_after.as_secs()));
        }
        response
    }
}
