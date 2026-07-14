use crate::pubsub::sfs_deleter::context::SFSDeleteContext;
use anyhow::Context;
use aws_sdk_sqs::types::Message;
use reqwest::StatusCode;
use sqs_client::email::SFSDeleteMessage;
use sqs_worker::cleanup_message;

/// Delete attachment from SFS
#[tracing::instrument(skip_all, err)]
pub async fn process_message(ctx: SFSDeleteContext, message: &Message) -> anyhow::Result<()> {
    let sfs_message = extract_sfs_delete_notification(message)?;
    tracing::debug!(sfs_message=?sfs_message, "Processing sfs delete message");

    match ctx
        .sfs_client
        .delete_file(sfs_message.sfs_id.to_string().as_str())
        .await
    {
        Ok(_) => {}
        Err(e) => {
            // Treat 404 as success - file is already gone
            if e.downcast_ref::<reqwest::Error>()
                .is_some_and(|re| re.status() == Some(StatusCode::NOT_FOUND))
            {
                tracing::info!(sfs_id = %sfs_message.sfs_id, "File already deleted from SFS");
            } else {
                return Err(e);
            }
        }
    }

    email_db_client::attachments::sfs::delete_attachment_sfs(&ctx.db, sfs_message.db_id).await?;
    tracing::debug!(sfs_message=?sfs_message, "Successfully deleted attachment from sfs");

    cleanup_message(&ctx.sqs_worker, message).await?;

    Ok(())
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
