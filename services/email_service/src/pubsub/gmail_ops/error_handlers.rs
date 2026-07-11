use crate::pubsub::gmail_ops::worker::GmailOpsContext;
use models_email::gmail::gmail_ops::GmailOpsPubsubMessage;
use models_email::service::pubsub::{DetailedError, ProcessingError};
use sqs_worker::cleanup_message;

/// Handles non-retryable errors by cleaning up the SQS message.
#[tracing::instrument(skip(ctx, message), err)]
pub async fn handle_non_retryable_error(
    ctx: &GmailOpsContext,
    message: &aws_sdk_sqs::types::Message,
    data: &GmailOpsPubsubMessage,
    e: &DetailedError,
) -> anyhow::Result<()> {
    tracing::error!(error = ?e, payload = ?data.operation, "Non-retryable error processing gmail ops message. The message will be deleted.");

    cleanup_message(&ctx.sqs_worker, message).await?;
    Ok(())
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
