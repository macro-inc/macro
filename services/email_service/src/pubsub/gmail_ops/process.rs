use crate::pubsub::gmail_ops::email_api_error::handle_email_api_error;
use crate::pubsub::gmail_ops::error_handlers::prefix_error_source;
use crate::pubsub::gmail_ops::operations::block_sender::block_sender;
use crate::pubsub::gmail_ops::operations::delete_label::delete_label;
use crate::pubsub::gmail_ops::operations::modify_message_labels::modify_message_labels;
use crate::pubsub::gmail_ops::operations::unblock_sender::unblock_sender;
use crate::pubsub::gmail_ops::worker::GmailOpsContext;
use anyhow::{Context, Result, anyhow};
use models_email::gmail::gmail_ops::{GmailOpsOperation, GmailOpsPubsubMessage};
use models_email::service::pubsub::{DetailedError, FailureReason, ProcessingError};
use sqs_worker::cleanup_message;

/// Processes a message from the gmail ops queue.
pub async fn process_message(
    ctx: GmailOpsContext,
    message: &aws_sdk_sqs::types::Message,
) -> Result<()> {
    let data = match extract_gmail_ops_message(message) {
        Ok(data) => data,
        Err(e) => {
            tracing::error!(error = %e, "Failed to extract gmail ops message, this is non-retryable.");
            if let Err(cleanup_err) = cleanup_message(&ctx.sqs_worker, message).await {
                tracing::error!(error = %cleanup_err, "Failed to clean up message after extraction error");
            }
            return Err(e);
        }
    };

    let processing_result = inner_process_message(&ctx, &data).await;

    match processing_result {
        Ok(()) => {
            cleanup_message(&ctx.sqs_worker, message).await?;
            Ok(())
        }
        Err(ProcessingError::NonRetryable(e)) => {
            crate::pubsub::gmail_ops::error_handlers::handle_non_retryable_error(
                &ctx, message, &data, &e,
            )
            .await
        }
        Err(ProcessingError::Retryable(e)) => {
            crate::pubsub::gmail_ops::error_handlers::handle_retryable_error(&data, &e).await
        }
    }
}

#[tracing::instrument(skip(ctx, data), err)]
async fn inner_process_message(
    ctx: &GmailOpsContext,
    data: &GmailOpsPubsubMessage,
) -> Result<(), ProcessingError> {
    let link = email_db_client::links::get::fetch_link_by_id(&ctx.db, data.link_id)
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e.context("Failed to fetch link from database"),
            })
        })?
        .ok_or_else(|| {
            ProcessingError::NonRetryable(DetailedError {
                reason: FailureReason::LinkNotFound,
                source: anyhow!("No link found for id {}", data.link_id),
            })
        })?;

    let (operation_name, operation_result) = match &data.operation {
        GmailOpsOperation::ModifyMessageLabels(payload) => (
            "modify_message_labels",
            modify_message_labels(ctx, &link, payload).await,
        ),
        GmailOpsOperation::DeleteLabel(payload) => {
            ("delete_label", delete_label(ctx, &link, payload).await)
        }
        GmailOpsOperation::BlockSender(payload) => {
            ("block_sender", block_sender(ctx, &link, payload).await)
        }
        GmailOpsOperation::UnblockSender(payload) => {
            ("unblock_sender", unblock_sender(ctx, &link, payload).await)
        }
    };

    if let Err(error) = operation_result {
        let processing_error = handle_email_api_error(ctx, data, error).await;
        return Err(prefix_error_source(processing_error, operation_name));
    }

    tracing::debug!(operation_name, "Successfully processed Gmail operation");
    Ok(())
}

/// Extracts the message from the SQS message body.
#[tracing::instrument(skip(message))]
fn extract_gmail_ops_message(
    message: &aws_sdk_sqs::types::Message,
) -> anyhow::Result<GmailOpsPubsubMessage> {
    let message_body = message.body().context("message body not found")?;
    let gmail_ops_message: GmailOpsPubsubMessage = serde_json::from_str(message_body)
        .context("Failed to deserialize message body to GmailOpsPubsubMessage")?;
    Ok(gmail_ops_message)
}
