use crate::pubsub::context::PubSubContext;
use models_email::gmail::inbox_sync::InboxSyncPubsubMessage;
use models_email::service::pubsub::{DetailedError, FailureReason, ProcessingError};
use sqs_worker::cleanup_message;

#[cfg(test)]
mod test;

/// Handles non-retryable errors by updating the appropriate status in the database and cleaning up the SQS message
#[tracing::instrument(skip(ctx, message))]
pub async fn handle_non_retryable_error(
    ctx: &PubSubContext,
    message: &aws_sdk_sqs::types::Message,
    data: &InboxSyncPubsubMessage,
    e: &DetailedError,
) -> anyhow::Result<()> {
    log_non_retryable_error(data, e);

    cleanup_message(&ctx.sqs_worker, message).await?;
    Ok(())
}

/// A rate-limited operation is only non-retryable here once it has been
/// re-enqueued to the retry queue, or when it is a notification that a later
/// one supersedes, so deleting it loses nothing.
fn log_non_retryable_error(data: &InboxSyncPubsubMessage, e: &DetailedError) {
    if e.reason == FailureReason::GmailApiRateLimited {
        tracing::debug!(error = %e, payload = format!("{:?}", data.operation), "Rate-limited inbox sync message deferred. The message will be deleted.");
    } else {
        tracing::error!(error = %e, payload = format!("{:?}", data.operation), "Non-retryable error processing inbox sync message. The message will be deleted.");
    }
}

/// Handles retryable errors by updating status to InProgress and adding the error message
#[tracing::instrument]
pub async fn handle_retryable_error(
    data: &InboxSyncPubsubMessage,
    e: &DetailedError,
) -> anyhow::Result<()> {
    tracing::debug!(error = %e, payload = format!("{:?}", data.operation), "Retryable error processing inbox sync message.");

    Ok(())
}

/// Adds an operation name prefix to a ProcessingError's source field
pub fn prefix_error_source(error: ProcessingError, operation_name: &str) -> ProcessingError {
    match error {
        ProcessingError::Retryable(DetailedError { reason, source }) => {
            ProcessingError::Retryable(DetailedError {
                reason,
                source: anyhow::anyhow!("{}: {}", operation_name, source),
            })
        }
        ProcessingError::NonRetryable(DetailedError { reason, source }) => {
            ProcessingError::NonRetryable(DetailedError {
                reason,
                source: anyhow::anyhow!("{}: {}", operation_name, source),
            })
        }
    }
}
