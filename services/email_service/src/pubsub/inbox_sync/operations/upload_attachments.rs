use crate::pubsub::context::PubSubContext;
use crate::pubsub::inbox_sync::operations::upsert_message::{
    AttachmentUploadEligibility, AttachmentUploads, upload_message_attachments,
};
use models_email::email::service::link;
use models_email::gmail::inbox_sync::UploadAttachmentsPayload;
use models_email::service::pubsub::{DetailedError, FailureReason, ProcessingError};
use tracing::Level;

/// Retries the attachment uploads of a message that a rate limit deferred. It is only enqueued
/// on the retry queue, so a further rate limit leaves it for SQS redelivery.
#[tracing::instrument(skip(ctx, link), fields(link_id = %link.id), err(Debug, level = Level::WARN))]
pub async fn upload_attachments(
    ctx: &PubSubContext,
    link: &link::Link,
    payload: &UploadAttachmentsPayload,
) -> Result<(), ProcessingError> {
    if cfg!(not(feature = "attachment_upload")) {
        return Ok(());
    }

    let eligibility = AttachmentUploadEligibility {
        documents: true,
        media: true,
    };
    match upload_message_attachments(ctx, link, &payload.provider_message_id, &eligibility).await? {
        AttachmentUploads::Finished => Ok(()),
        AttachmentUploads::RateLimited => Err(ProcessingError::Retryable(DetailedError {
            reason: FailureReason::GmailApiRateLimited,
            source: anyhow::anyhow!("Attachment upload is still rate limited"),
        })),
    }
}
