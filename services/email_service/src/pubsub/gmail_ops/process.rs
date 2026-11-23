use crate::pubsub::gmail_ops::error_handlers;
use crate::pubsub::gmail_ops::worker::GmailOpsContext;
use anyhow::{Context, Result};
use email::domain::message_labels::gmail_ops::GmailOpsDisposition;
use models_email::gmail::gmail_ops::GmailOpsPubsubMessage;
use sqs_worker::cleanup_message;

/// Decode one delivery, then perform only the acknowledgement selected by the domain.
pub(crate) async fn process_message(
    ctx: GmailOpsContext,
    message: &aws_sdk_sqs::types::Message,
) -> Result<()> {
    let disposition = ctx
        .service
        .process(extract_gmail_ops_message(message))
        .await;
    match disposition {
        GmailOpsDisposition::DoneDelete => {
            cleanup_message(&ctx.sqs_worker, message).await?;
            Ok(())
        }
        GmailOpsDisposition::InvalidDelete(e) => {
            if let Err(cleanup_err) = cleanup_message(&ctx.sqs_worker, message).await {
                tracing::error!(error = %cleanup_err, "Failed to clean up message after extraction error");
            }
            Err(e)
        }
        GmailOpsDisposition::FailureDelete { data, error, log } => {
            error_handlers::handle_non_retryable_error(&ctx, message, &data, &error, log).await
        }
        GmailOpsDisposition::LeaveForRedelivery { data, error } => {
            error_handlers::handle_retryable_error(&data, &error).await
        }
    }
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
