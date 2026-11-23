use crate::pubsub::scheduled::context::ScheduledContext;
use anyhow::Context;
use models_email::service::pubsub::ScheduledPubsubMessage;
use sqs_worker::cleanup_message;

#[tracing::instrument(skip(ctx, message), err)]
pub async fn process_message(
    ctx: ScheduledContext,
    message: &aws_sdk_sqs::types::Message,
) -> anyhow::Result<()> {
    let data = extract_scheduled_message(message)?;
    ctx.service.deliver(data.link_id, data.message_id).await?;
    cleanup_message(&ctx.sqs_worker, message).await?;
    Ok(())
}

#[tracing::instrument(skip(message), err)]
fn extract_scheduled_message(
    message: &aws_sdk_sqs::types::Message,
) -> anyhow::Result<ScheduledPubsubMessage> {
    let message_body = message.body().context("message body not found")?;
    serde_json::from_str(message_body)
        .context("Failed to deserialize message body to ScheduledPubsubMessage")
}
