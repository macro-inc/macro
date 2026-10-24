use email_api_client::domain::models::EmailApiError;
use models_email::gmail::gmail_ops::GmailOpsPubsubMessage;
use models_email::service::pubsub::{DetailedError, FailureReason, ProcessingError};
use std::time::Duration;

use crate::pubsub::gmail_ops::worker::GmailOpsContext;
use crate::pubsub::rate_limit_backoff::next_retry_delay;

#[cfg(test)]
mod test;

#[derive(Debug, PartialEq, Eq)]
enum ErrorPolicy {
    RateLimited { retry_after: Option<Duration> },
    Retry,
    Permanent,
}

#[derive(Debug, PartialEq, Eq)]
enum RateLimitRoute {
    EnqueueRetry,
    RetryAfterVisibilityTimeout,
}

fn error_policy(error: &EmailApiError) -> ErrorPolicy {
    // Exhaustive: a new EmailApiError variant must force a policy decision
    // here rather than silently dropping the operation as permanent.
    match error {
        EmailApiError::RateLimited { retry_after, .. } => ErrorPolicy::RateLimited {
            retry_after: *retry_after,
        },
        EmailApiError::Transient { .. } => ErrorPolicy::Retry,
        EmailApiError::AuthRequired
        | EmailApiError::Forbidden
        | EmailApiError::NotFound
        | EmailApiError::Conflict
        | EmailApiError::OutdatedCursor
        | EmailApiError::SendRejected { .. }
        | EmailApiError::Permanent { .. } => ErrorPolicy::Permanent,
    }
}

pub(crate) async fn handle_email_api_error(
    ctx: &GmailOpsContext,
    sqs_message: &aws_sdk_sqs::types::Message,
    data: &GmailOpsPubsubMessage,
    error: EmailApiError,
) -> ProcessingError {
    match error_policy(&error) {
        ErrorPolicy::RateLimited { retry_after } => {
            handle_rate_limit(ctx, sqs_message, data, error, retry_after).await
        }
        ErrorPolicy::Retry => processing_error(error, true),
        ErrorPolicy::Permanent => processing_error(error, false),
    }
}

async fn handle_rate_limit(
    ctx: &GmailOpsContext,
    sqs_message: &aws_sdk_sqs::types::Message,
    data: &GmailOpsPubsubMessage,
    error: EmailApiError,
    retry_after: Option<Duration>,
) -> ProcessingError {
    let delay = next_retry_delay(
        ctx.retry_worker,
        sqs_worker::receive_count(sqs_message).unwrap_or(1),
        retry_after,
    );

    if rate_limit_route(ctx.retry_worker) == RateLimitRoute::RetryAfterVisibilityTimeout {
        tracing::info!(
            link_id = %data.link_id,
            delay_seconds = delay.as_secs(),
            "Gmail API rate limited in retry worker, message will be retried after visibility timeout"
        );
        // On failure the queue's own visibility timeout still redelivers it.
        ctx.sqs_worker
            .change_message_visibility(sqs_message, delay)
            .await
            .ok();
        return processing_error(error, true);
    }

    tracing::info!(
        link_id = %data.link_id,
        delay_seconds = delay.as_secs(),
        "Gmail API rate limited, moving message from primary queue to retry queue"
    );
    if let Err(enqueue_error) = ctx
        .sqs_client
        .enqueue_gmail_ops_retry_notification(data.clone(), delay)
        .await
    {
        return ProcessingError::Retryable(DetailedError {
            reason: FailureReason::SqsEnqueueFailed,
            source: enqueue_error.context("Failed to enqueue gmail ops retry message"),
        });
    }

    processing_error(error, false)
}

fn rate_limit_route(retry_worker: bool) -> RateLimitRoute {
    if retry_worker {
        RateLimitRoute::RetryAfterVisibilityTimeout
    } else {
        RateLimitRoute::EnqueueRetry
    }
}

fn processing_error(error: EmailApiError, retryable: bool) -> ProcessingError {
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
    let detail = DetailedError {
        reason,
        source: anyhow::Error::new(error),
    };

    if retryable {
        ProcessingError::Retryable(detail)
    } else {
        ProcessingError::NonRetryable(detail)
    }
}

pub(crate) fn is_permanent_mutation_error(error: &EmailApiError) -> bool {
    matches!(error_policy(error), ErrorPolicy::Permanent)
}

pub(crate) fn is_delete_label_success(error: &EmailApiError) -> bool {
    matches!(error, EmailApiError::NotFound)
}
