use axum::http::header::RETRY_AFTER;
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use email_api_client::domain::models::EmailApiError;

#[cfg(test)]
mod test;

/// Response headers implied by a rate limit: its suggested delay, when known,
/// as a `Retry-After` header rounded up to whole seconds, so a sub-second wait
/// is not sent as `0`.
pub(crate) fn provider_error_headers(error: &EmailApiError) -> HeaderMap {
    let mut headers = HeaderMap::new();
    if let EmailApiError::RateLimited {
        retry_after: Some(delay),
        ..
    } = error
        && let Ok(value) = HeaderValue::from_str(&delay.as_millis().div_ceil(1_000).to_string())
    {
        headers.insert(RETRY_AFTER, value);
    }
    headers
}

pub(crate) fn provider_error_status(error: &EmailApiError) -> StatusCode {
    match error {
        EmailApiError::RateLimited { .. } => StatusCode::TOO_MANY_REQUESTS,
        EmailApiError::ContentTooLarge => StatusCode::PAYLOAD_TOO_LARGE,
        EmailApiError::AuthRequired => StatusCode::UNAUTHORIZED,
        EmailApiError::Forbidden => StatusCode::FORBIDDEN,
        EmailApiError::NotFound => StatusCode::NOT_FOUND,
        EmailApiError::Conflict | EmailApiError::OutdatedCursor => StatusCode::CONFLICT,
        EmailApiError::SendRejected { .. } => StatusCode::BAD_REQUEST,
        EmailApiError::Transient { .. }
        | EmailApiError::CredentialsUnavailable { .. }
        | EmailApiError::Permanent { .. } => StatusCode::INTERNAL_SERVER_ERROR,
    }
}

/// Closed content-limit response shared by provider-backed message paths.
#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct ContentTooLargeResponse {
    code: ContentTooLargeCode,
    message: &'static str,
}
#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
enum ContentTooLargeCode {
    MessageTooLarge,
}
impl Default for ContentTooLargeResponse {
    fn default() -> Self {
        Self {
            code: ContentTooLargeCode::MessageTooLarge,
            message: "This message is too large to open in Macro (over 25 MB).",
        }
    }
}
