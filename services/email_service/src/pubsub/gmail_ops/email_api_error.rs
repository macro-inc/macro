use email_api_client::domain::models::EmailApiError;
use models_email::gmail::gmail_ops::GmailOpsPubsubMessage;
use models_email::service::pubsub::{DetailedError, FailureReason, ProcessingError};

use crate::pubsub::gmail_ops::worker::GmailOpsContext;

#[cfg(test)]
mod test;

#[derive(Debug, PartialEq, Eq)]
enum ErrorPolicy {
    RateLimited,
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
        EmailApiError::RateLimited { .. } => ErrorPolicy::RateLimited,
        EmailApiError::Transient { .. } => ErrorPolicy::Retry,
        EmailApiError::AuthRequired
        | EmailApiError::Forbidden
        | EmailApiError::NotFound
        | EmailApiError::Conflict
        | EmailApiError::OutdatedCursor
        | EmailApiError::Permanent { .. } => ErrorPolicy::Permanent,
    }
}

pub(crate) async fn handle_email_api_error(
    ctx: &GmailOpsContext,
    data: &GmailOpsPubsubMessage,
    error: EmailApiError,
) -> ProcessingError {
    match error_policy(&error) {
        ErrorPolicy::RateLimited => handle_rate_limit(ctx, data, error).await,
        ErrorPolicy::Retry => processing_error(error, true),
        ErrorPolicy::Permanent => processing_error(error, false),
    }
}

async fn handle_rate_limit(
    ctx: &GmailOpsContext,
    data: &GmailOpsPubsubMessage,
    error: EmailApiError,
) -> ProcessingError {
    if rate_limit_route(ctx.retry_worker) == RateLimitRoute::RetryAfterVisibilityTimeout {
        tracing::info!(
            link_id = %data.link_id,
            "Gmail API rate limited in retry worker, message will be retried after visibility timeout"
        );
        return processing_error(error, true);
    }

    tracing::info!(
        link_id = %data.link_id,
        "Gmail API rate limited, moving message from primary queue to retry queue"
    );
    if let Err(enqueue_error) = ctx
        .sqs_client
        .enqueue_gmail_ops_retry_notification(data.clone())
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
