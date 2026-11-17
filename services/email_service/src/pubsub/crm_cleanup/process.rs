use crate::pubsub::crm_cleanup::worker::CrmCleanupContext;
use anyhow::Context;
use email::domain::crm_cleanup::CrmCleanupDisposition;
use models_email::service::crm_cleanup::CrmCleanupPubsubMessage;
use sqs_worker::cleanup_message;

/// Decode a delivery and perform only the acknowledgement selected by the domain.
pub async fn process_message(
    ctx: CrmCleanupContext,
    message: &aws_sdk_sqs::types::Message,
) -> anyhow::Result<()> {
    match ctx
        .service
        .process(extract_cleanup_message(message).map(|data| data.operation))
        .await
    {
        CrmCleanupDisposition::Delete => cleanup_message(&ctx.sqs_worker, message).await,
        CrmCleanupDisposition::InvalidDelete(error) => {
            if let Err(cleanup_err) = cleanup_message(&ctx.sqs_worker, message).await {
                tracing::error!(error = %cleanup_err, "Failed to clean up message after extraction error");
            }
            Err(error)
        }
        CrmCleanupDisposition::LeaveForRedelivery => Ok(()),
    }
}

/// Extracts the crm cleanup message from the SQS message body
#[tracing::instrument(skip(message))]
fn extract_cleanup_message(
    message: &aws_sdk_sqs::types::Message,
) -> anyhow::Result<CrmCleanupPubsubMessage> {
    let message_body = message.body().context("message body not found")?;

    let cleanup_message: CrmCleanupPubsubMessage = serde_json::from_str(message_body)
        .context("Failed to deserialize message body to CrmCleanupPubsubMessage")?;

    Ok(cleanup_message)
}
