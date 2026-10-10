use crate::pubsub::gmail_ops::worker::GmailOpsContext;
use models_email::gmail::gmail_ops::GmailOpsPubsubMessage;
use models_email::service::pubsub::{DetailedError, FailureReason, ProcessingError};
use sqs_worker::cleanup_message;

#[cfg(test)]
mod test;

/// Handles non-retryable errors by cleaning up the SQS message.
#[tracing::instrument(skip(ctx, message), err)]
pub async fn handle_non_retryable_error(
    ctx: &GmailOpsContext,
    message: &aws_sdk_sqs::types::Message,
    data: &GmailOpsPubsubMessage,
    e: &DetailedError,
) -> anyhow::Result<()> {
    log_non_retryable_error(data, e);

    cleanup_message(&ctx.sqs_worker, message).await?;
    Ok(())
}

/// A rate-limited operation is only non-retryable here once it has been
/// re-enqueued to the retry queue, so deleting it loses nothing.
fn log_non_retryable_error(data: &GmailOpsPubsubMessage, e: &DetailedError) {
    if e.reason == FailureReason::GmailApiRateLimited {
        tracing::debug!(error = ?e, payload = ?data.operation, "Rate-limited gmail ops message deferred. The message will be deleted.");
    } else {
        tracing::error!(error = ?e, payload = ?data.operation, "Non-retryable error processing gmail ops message. The message will be deleted.");
    }
}

/// Handles retryable errors by leaving the message in the queue.
#[tracing::instrument(skip(data, e), err)]
pub async fn handle_retryable_error(
    data: &GmailOpsPubsubMessage,
    e: &DetailedError,
) -> anyhow::Result<()> {
    tracing::debug!(error = ?e, payload = ?data.operation, "Retryable error processing gmail ops message.");

    Ok(())
}

/// Adds an operation name prefix to a ProcessingError's source field.
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
