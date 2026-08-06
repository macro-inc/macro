use email_api_client::domain::models::EmailApiError;
use models_email::email::service::pubsub::{DetailedError, FailureReason, ProcessingError};

#[cfg(test)]
mod test;

pub(crate) fn map_email_api_error(error: EmailApiError, context: &'static str) -> ProcessingError {
    let reason = match &error {
        EmailApiError::RateLimited { .. } => FailureReason::GmailApiRateLimited,
        EmailApiError::AuthRequired => FailureReason::AccessTokenFetchFailed,
        EmailApiError::OutdatedCursor => FailureReason::OutdatedHistoryId,
        _ => FailureReason::GmailApiFailed,
    };
    let is_retryable = error.is_transient();
    let detail = DetailedError {
        reason,
        source: anyhow::Error::new(error).context(context),
    };

    if is_retryable {
        ProcessingError::Retryable(detail)
    } else {
        ProcessingError::NonRetryable(detail)
    }
}
