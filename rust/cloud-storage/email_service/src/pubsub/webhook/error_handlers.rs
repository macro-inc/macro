use crate::pubsub::context::PubSubContext;
use models_email::gmail::webhook::WebhookPubsubMessage;
use models_email::service::pubsub::{DetailedError, ProcessingError};
use sqs_worker::cleanup_message;

/// Handles non-retryable errors by updating the appropriate status in the database and cleaning up the SQS message
#[tracing::instrument(skip(ctx, message))]
pub async fn handle_non_retryable_error(
    ctx: &PubSubContext,
    message: &aws_sdk_sqs::types::Message,
    data: &WebhookPubsubMessage,
    e: &DetailedError,
) -> anyhow::Result<()> {
    tracing::error!(error = %e, payload = format!("{:?}", data.operation), "Non-retryable error processing webhook message. The message will be deleted.");

    cleanup_message(&ctx.sqs_worker, message).await?;
    Ok(())
}

/// Handles retryable errors by updating status to InProgress and adding the error message
#[tracing::instrument]
pub async fn handle_retryable_error(
    data: &WebhookPubsubMessage,
    e: &DetailedError,
) -> anyhow::Result<()> {
    tracing::debug!(error = %e, payload = format!("{:?}", data.operation), "Retryable error processing webhook message.");

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
