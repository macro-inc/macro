use email_api_client::domain::models::EmailApiError;
use models_email::gmail::inbox_sync::{InboxSyncOperation, InboxSyncPubsubMessage};
use models_email::service::pubsub::{DetailedError, FailureReason, ProcessingError};

use super::InboxSyncQueue;
use crate::domain::mailbox::connection::ConnectionSourceError;

#[cfg(test)]
mod test;

#[derive(Debug, PartialEq, Eq)]
enum RateLimitRoute {
    EnqueueRetry,
    RetryAfterVisibilityTimeout,
}

fn rate_limit_route(retry_worker: bool) -> RateLimitRoute {
    if retry_worker {
        RateLimitRoute::RetryAfterVisibilityTimeout
    } else {
        RateLimitRoute::EnqueueRetry
    }
}

/// Classify a provider refusal and publish the original operation only when required.
pub async fn handle_operation_error<Q: InboxSyncQueue>(
    queue: &Q,
    retry_worker: bool,
    link_id: uuid::Uuid,
    operation: InboxSyncOperation,
    error: EmailApiError,
) -> ProcessingError {
    if !matches!(error, EmailApiError::RateLimited { .. }) {
        return processing_error(error);
    }

    if rate_limit_route(retry_worker) == RateLimitRoute::RetryAfterVisibilityTimeout {
        return processing_error(error);
    }

    let message = InboxSyncPubsubMessage { link_id, operation };
    if let Err(enqueue_error) = queue.enqueue_retry(message).await {
        return ProcessingError::Retryable(DetailedError {
            reason: FailureReason::SqsEnqueueFailed,
            source: enqueue_error
                .into_original()
                .context("Failed to enqueue inbox sync retry message"),
        });
    }

    non_retryable(error)
}

fn processing_error(error: EmailApiError) -> ProcessingError {
    if error.is_transient() || matches!(error, EmailApiError::RateLimited { .. }) {
        ProcessingError::Retryable(detail(error))
    } else {
        non_retryable(error)
    }
}

fn non_retryable(error: EmailApiError) -> ProcessingError {
    ProcessingError::NonRetryable(detail(error))
}

fn detail(error: EmailApiError) -> DetailedError {
    // Exhaustive: a new EmailApiError variant must force a policy decision
    // here rather than silently falling into a catch-all.
    let reason = match error {
        EmailApiError::RateLimited { .. } => FailureReason::GmailApiRateLimited,
        EmailApiError::AuthRequired => FailureReason::AccessTokenFetchFailed,
        EmailApiError::OutdatedCursor => FailureReason::OutdatedHistoryId,
        EmailApiError::Forbidden
        | EmailApiError::NotFound
        | EmailApiError::Conflict
        | EmailApiError::Transient { .. }
        | EmailApiError::CredentialsUnavailable { .. }
        | EmailApiError::SendRejected { .. }
        | EmailApiError::Permanent { .. } => FailureReason::GmailApiFailed,
    };
    DetailedError {
        reason,
        source: anyhow::Error::new(error),
    }
}
