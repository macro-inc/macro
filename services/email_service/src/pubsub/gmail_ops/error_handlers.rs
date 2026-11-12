//! Acknowledgement boundaries retain the original spans around domain-selected outcomes.

use crate::pubsub::gmail_ops::worker::GmailOpsContext;
use email::domain::message_labels::gmail_ops::{GmailOpsFailureLog, record_retryable_error};
use models_email::gmail::gmail_ops::GmailOpsPubsubMessage;
use models_email::service::pubsub::DetailedError;
use sqs_worker::cleanup_message;

/// Perform the domain's delete disposition under the existing failure span.
#[tracing::instrument(skip(ctx, message, log), err)]
pub(crate) async fn handle_non_retryable_error(
    ctx: &GmailOpsContext,
    message: &aws_sdk_sqs::types::Message,
    data: &GmailOpsPubsubMessage,
    e: &DetailedError,
    log: GmailOpsFailureLog,
) -> anyhow::Result<()> {
    log.record(data, e);
    cleanup_message(&ctx.sqs_worker, message).await?;
    Ok(())
}

/// Acknowledge completion of this attempt without deleting a retryable delivery.
#[tracing::instrument(skip(data, e), err)]
pub(crate) async fn handle_retryable_error(
    data: &GmailOpsPubsubMessage,
    e: &DetailedError,
) -> anyhow::Result<()> {
    record_retryable_error(data, e);
    Ok(())
}
