use axum::http::header::RETRY_AFTER;
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use email_api_client::domain::models::EmailApiError;

#[cfg(test)]
mod test;

/// Response headers implied by a provider error: rate-limited requests carry
/// the provider's suggested delay as a `Retry-After` header when known.
pub(crate) fn provider_error_headers(error: &EmailApiError) -> HeaderMap {
    let mut headers = HeaderMap::new();
    if let EmailApiError::RateLimited {
        retry_after: Some(delay),
        ..
    } = error
        && let Ok(value) = HeaderValue::from_str(&delay.as_secs().to_string())
    {
        headers.insert(RETRY_AFTER, value);
    }
    headers
}

pub(crate) fn provider_error_status(error: &EmailApiError) -> StatusCode {
    match error {
        EmailApiError::RateLimited { .. } => StatusCode::TOO_MANY_REQUESTS,
        EmailApiError::AuthRequired => StatusCode::UNAUTHORIZED,
        EmailApiError::Forbidden => StatusCode::FORBIDDEN,
        EmailApiError::NotFound => StatusCode::NOT_FOUND,
        EmailApiError::Conflict | EmailApiError::OutdatedCursor => StatusCode::CONFLICT,
        EmailApiError::Transient { .. } | EmailApiError::Permanent { .. } => {
            StatusCode::INTERNAL_SERVER_ERROR
        }
    }
}
