use crate::pubsub::inbox_sync::error_handlers;
use crate::pubsub::inbox_sync::worker::InboxSyncContext;
use anyhow::{Context, Result};
use email::domain::mailbox::inbox_sync::InboxSyncDisposition;
use models_email::gmail::inbox_sync::InboxSyncPubsubMessage;
use sqs_worker::cleanup_message;

/// Decode one delivery and perform only the domain-selected acknowledgement.
pub(crate) async fn process_message(
    ctx: InboxSyncContext,
    message: &aws_sdk_sqs::types::Message,
) -> Result<()> {
    let disposition = ctx
        .service
        .process(extract_inbox_sync_message(message), &ctx.legacy)
        .await;
    match disposition {
        InboxSyncDisposition::DoneDelete => {
            cleanup_message(&ctx.sqs_worker, message).await?;
            Ok(())
        }
        InboxSyncDisposition::InvalidDelete(e) => {
            if let Err(cleanup_err) = cleanup_message(&ctx.sqs_worker, message).await {
                tracing::error!(error = %cleanup_err, "Failed to clean up message after extraction error");
            }
            Err(e)
        }
        InboxSyncDisposition::FailureDelete { data, error, log } => {
            error_handlers::handle_non_retryable_error(&ctx, message, &data, &error, log).await
        }
        InboxSyncDisposition::LeaveForRedelivery { data, error } => {
            error_handlers::handle_retryable_error(&data, &error).await
        }
    }
}

/// Extracts backfill message from the SQS message body
#[tracing::instrument(skip(message))]
fn extract_inbox_sync_message(
    message: &aws_sdk_sqs::types::Message,
) -> anyhow::Result<InboxSyncPubsubMessage> {
    let message_body = message.body().context("message body not found")?;

    // Deserialize the JSON string into a BackfillPubsubMessage
    let backfill_message: InboxSyncPubsubMessage = serde_json::from_str(message_body)
        .context("Failed to deserialize message body to InboxSyncOperation")?;

    Ok(backfill_message)
}
