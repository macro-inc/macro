use crate::pubsub::inbox_sync::worker::InboxSyncContext;
use email::domain::mailbox::inbox_sync::{InboxSyncFailureLog, record_retryable_error};
use models_email::gmail::inbox_sync::InboxSyncPubsubMessage;
use models_email::service::pubsub::DetailedError;
use sqs_worker::cleanup_message;

#[cfg(test)]
mod test;

/// Log the domain-selected failure and perform its terminal acknowledgement.
#[tracing::instrument(skip(ctx, message, log))]
pub(crate) async fn handle_non_retryable_error(
    ctx: &InboxSyncContext,
    message: &aws_sdk_sqs::types::Message,
    data: &InboxSyncPubsubMessage,
    e: &DetailedError,
    log: InboxSyncFailureLog,
) -> anyhow::Result<()> {
    log.record(data, e);
    cleanup_message(&ctx.sqs_worker, message).await?;
    Ok(())
}

/// Retain a retryable delivery after recording its existing error event.
#[tracing::instrument]
pub(crate) async fn handle_retryable_error(
    data: &InboxSyncPubsubMessage,
    e: &DetailedError,
) -> anyhow::Result<()> {
    record_retryable_error(data, e);
    Ok(())
}
