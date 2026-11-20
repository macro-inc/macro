use crate::pubsub::sfs_deleter::context::SFSDeleteContext;
use anyhow::Context;
use aws_sdk_sqs::types::Message;
use email::domain::attachment_cleanup::sfs_deletion::SfsDeletionDisposition;
use sqs_client::email::SFSDeleteMessage;
use sqs_worker::cleanup_message;

/// Delete attachment from SFS
#[tracing::instrument(skip_all, err)]
pub async fn process_message(ctx: SFSDeleteContext, message: &Message) -> anyhow::Result<()> {
    let disposition = ctx
        .service
        .process(extract_sfs_delete_notification(message).map(|data| (data.db_id, data.sfs_id)))
        .await;
    match disposition {
        SfsDeletionDisposition::Delete => cleanup_message(&ctx.sqs_worker, message).await,
        SfsDeletionDisposition::LeaveForRedelivery(error) => Err(error),
    }
}

/// Deserializes the SQS message body into a SFSDeleteMessage struct.
#[tracing::instrument(skip(message), err)]
fn extract_sfs_delete_notification(
    message: &aws_sdk_sqs::types::Message,
) -> anyhow::Result<SFSDeleteMessage> {
    let message_body = message.body().context("message body not found")?;

    serde_json::from_str(message_body)
        .context("Failed to deserialize message body to SFSDeleteMessage")
}
