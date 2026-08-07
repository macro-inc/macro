use email_api_client::domain::models::{EmailApiError, RateLimitOrigin};
use models_email::gmail::inbox_sync::{InboxSyncOperation, InboxSyncPubsubMessage};
use models_email::service::pubsub::{DetailedError, FailureReason, ProcessingError};

use crate::pubsub::context::PubSubContext;

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
    link_id: uuid::Uuid,
    operation: InboxSyncOperation,
    error: EmailApiError,
) -> ProcessingError {
    if !matches!(error, EmailApiError::RateLimited { .. }) {
        return processing_error(error);
    }

    if rate_limit_route(ctx.retry_worker) == RateLimitRoute::RetryAfterVisibilityTimeout {
        return processing_error(error);
    }

    let message = InboxSyncPubsubMessage { link_id, operation };
    if let Err(enqueue_error) = ctx
        .sqs_client
        .enqueue_gmail_retry_inbox_sync_notification(message)
        .await
    {
        return ProcessingError::Retryable(DetailedError {
            reason: FailureReason::SqsEnqueueFailed,
            source: enqueue_error.context("Failed to enqueue inbox sync retry message"),
        });
    }

    non_retryable(error)
}

pub(crate) fn handle_gmail_message_error(error: EmailApiError) -> ProcessingError {
    // Local budget refusals drop the notification by design: no provider
    // quota was consumed and a later notification covers the same cursor
    // range, avoiding fan-out backpressure. A provider-origin 429 retries
    // (main's behavior) so an idle mailbox does not stay unsynced until its
    // next change.
    if matches!(
        error,
        EmailApiError::RateLimited {
            origin: RateLimitOrigin::Local,
            ..
        }
    ) {
        return non_retryable(error);
    }

    processing_error(error)
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
        | EmailApiError::Permanent { .. } => FailureReason::GmailApiFailed,
    };
    DetailedError {
        reason,
        source: anyhow::Error::new(error),
    }
}
