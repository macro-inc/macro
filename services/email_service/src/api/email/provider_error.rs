use axum::http::StatusCode;
use email_api_client::domain::models::EmailApiError;

#[cfg(test)]
mod test;

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
