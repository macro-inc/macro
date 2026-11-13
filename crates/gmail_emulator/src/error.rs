//! Google's API error responses.

use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde_json::json;

/// An error answered the way Google's JSON APIs answer it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ApiError {
    pub(crate) status: u16,
    pub(crate) message: String,
    /// `errors[0].reason`, such as `notFound` or `rateLimitExceeded`.
    pub(crate) reason: &'static str,
    /// `errors[0].domain`.
    pub(crate) domain: &'static str,
    /// The canonical status name, such as `NOT_FOUND`.
    pub(crate) status_name: &'static str,
    pub(crate) retry_after_seconds: Option<u64>,
}

impl ApiError {
    pub(crate) fn new(
        status: u16,
        reason: &'static str,
        status_name: &'static str,
        message: &str,
    ) -> Self {
        Self {
            status,
            message: message.to_string(),
            reason,
            domain: "global",
            status_name,
            retry_after_seconds: None,
        }
    }

    /// An error of the Calendar API, which names its own reasons.
    pub(crate) fn calendar(status: u16, reason: &'static str, message: &str) -> Self {
        let status_name = match status {
            400 => "INVALID_ARGUMENT",
            403 => "PERMISSION_DENIED",
            404 => "NOT_FOUND",
            409 => "ALREADY_EXISTS",
            410 => "FAILED_PRECONDITION",
            412 => "FAILED_PRECONDITION",
            _ => "UNKNOWN",
        };
        Self::new(status, reason, status_name, message)
    }

    pub(crate) fn not_found() -> Self {
        Self::new(
            404,
            "notFound",
            "NOT_FOUND",
            "Requested entity was not found.",
        )
    }

    pub(crate) fn invalid_argument(message: &str) -> Self {
        Self::new(400, "invalidArgument", "INVALID_ARGUMENT", message)
    }

    pub(crate) fn failed_precondition(message: &str) -> Self {
        Self::new(400, "failedPrecondition", "FAILED_PRECONDITION", message)
    }

    pub(crate) fn conflict(message: &str) -> Self {
        Self::new(409, "aborted", "ABORTED", message)
    }

    pub(crate) fn unauthenticated() -> Self {
        Self::new(
            401,
            "authError",
            "UNAUTHENTICATED",
            "Request had invalid authentication credentials. Expected OAuth 2 access token, \
             login cookie or other valid authentication credential.",
        )
    }

    pub(crate) fn permission_denied(message: &str) -> Self {
        Self::new(403, "forbidden", "PERMISSION_DENIED", message)
    }

    /// Gmail's per-user rate limit: 429 `rateLimitExceeded`.
    pub(crate) fn rate_limited(message: &str, retry_after_seconds: Option<u64>) -> Self {
        Self {
            domain: "usageLimits",
            retry_after_seconds,
            ..Self::new(429, "rateLimitExceeded", "RESOURCE_EXHAUSTED", message)
        }
    }

    /// Gmail's quota exhaustion in its 403 form.
    pub(crate) fn quota_exceeded(reason: &'static str, message: &str) -> Self {
        Self {
            domain: "usageLimits",
            ..Self::new(403, reason, "PERMISSION_DENIED", message)
        }
    }

    pub(crate) fn backend(status: u16, status_name: &'static str, message: &str) -> Self {
        Self::new(status, "backendError", status_name, message)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let body = json!({
            "error": {
                "code": self.status,
                "message": self.message,
                "errors": [{
                    "message": self.message,
                    "domain": self.domain,
                    "reason": self.reason,
                }],
                "status": self.status_name,
            }
        });
        let status = StatusCode::from_u16(self.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
        let mut response = (status, axum::Json(body)).into_response();

        if let Some(seconds) = self.retry_after_seconds {
            response
                .headers_mut()
                .insert(header::RETRY_AFTER, HeaderValue::from(seconds));
        }

        response
    }
}
