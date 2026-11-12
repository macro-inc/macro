use crate::pubsub::sfs_uploader::context::SFSUploaderContext;
use anyhow::Context;
use aws_sdk_sqs::types::Message;
use email::domain::mailbox::contacts::sfs_upload::SfsPhotoUploadDisposition;
use models_email::service::pubsub::SFSUploaderMessage;
use sqs_worker::cleanup_message;

#[cfg(test)]
mod test;

/// Decode the upload and perform the acknowledgement selected by the domain.
pub async fn process_message(ctx: SFSUploaderContext, message: &Message) -> anyhow::Result<()> {
    let disposition = ctx
        .service
        .process(extract_sfs_upload_notification(message).map(|data| data.contact))
        .await;
    match disposition {
        SfsPhotoUploadDisposition::Delete => cleanup_message(&ctx.sqs_worker, message).await,
        SfsPhotoUploadDisposition::LeaveForRedelivery(error) => Err(error),
    }
}

/// Deserializes the SQS message body into a SfsUploaderMessage struct.
#[tracing::instrument(skip(message))]
fn extract_sfs_upload_notification(
    message: &aws_sdk_sqs::types::Message,
) -> anyhow::Result<SFSUploaderMessage> {
    tracing::debug!("Extracting sfs upload notification from message");
    let message_body = message.body().context("message body not found")?;

    serde_json::from_str(message_body)
        .context("Failed to deserialize message body to SFSUploaderMessage")
}
