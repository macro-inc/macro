use email_api_client::domain::models::EmailApiError;
use models_email::gmail::inbox_sync::{InboxSyncOperation, InboxSyncPubsubMessage};
use models_email::service::pubsub::{DetailedError, FailureReason, ProcessingError};

use crate::pubsub::context::PubSubContext;
use crate::pubsub::rate_limit_backoff::next_retry_delay;

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

pub(crate) async fn handle_operation_error(
    ctx: &PubSubContext,
    sqs_message: &aws_sdk_sqs::types::Message,
    link_id: uuid::Uuid,
    operation: InboxSyncOperation,
    error: EmailApiError,
) -> ProcessingError {
    let EmailApiError::RateLimited { retry_after, .. } = error else {
        return processing_error(error);
    };
    let delay = next_retry_delay(
        ctx.retry_worker,
        sqs_worker::receive_count(sqs_message).unwrap_or(1),
        retry_after,
    );

    if rate_limit_route(ctx.retry_worker) == RateLimitRoute::RetryAfterVisibilityTimeout {
        // On failure the queue's own visibility timeout still redelivers it.
        ctx.sqs_worker
            .change_message_visibility(sqs_message, delay)
            .await
            .ok();
        return processing_error(error);
    }

    let message = InboxSyncPubsubMessage { link_id, operation };
    if let Err(enqueue_error) = ctx
        .sqs_client
        .enqueue_gmail_retry_inbox_sync_notification(message, delay)
        .await
    {
        return ProcessingError::Retryable(DetailedError {
            reason: FailureReason::SqsEnqueueFailed,
            source: enqueue_error.context("Failed to enqueue inbox sync retry message"),
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
        | EmailApiError::SendRejected { .. }
        | EmailApiError::Permanent { .. } => FailureReason::GmailApiFailed,
    };
    DetailedError {
        reason,
        source: anyhow::Error::new(error),
    }
}
