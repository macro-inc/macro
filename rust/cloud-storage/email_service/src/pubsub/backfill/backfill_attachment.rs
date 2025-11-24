use crate::pubsub::context::PubSubContext;
use crate::util::upload_attachment::upload_attachment;
use models_email::service::backfill::BackfillAttachmentPayload;
use models_email::service::link;
use models_email::service::pubsub::{DetailedError, FailureReason, ProcessingError};
use uuid::Uuid;

/// this step is invoked by the UpdateMetadata step. it uploads the specified attachment as a
/// Macro document for the user. first checks the attachment doesn't already exist by querying
/// document_email table before fetching and uploading the attachment data.
#[tracing::instrument(skip(ctx, access_token))]
pub async fn backfill_attachment(
    ctx: &PubSubContext,
    access_token: &str,
    link: &link::Link,
    p: &BackfillAttachmentPayload,
) -> Result<(), ProcessingError> {
    // Check if a document for this attachment already exists before uploading.
    if attachment_document_exists(ctx, link.id, p.metadata.attachment_db_id).await? {
        return Ok(());
    }

    upload_attachment(
        &ctx.redis_client,
        &ctx.gmail_client,
        &ctx.dss_client,
        access_token,
        link,
        &p.metadata,
    )
    .await
    .map_err(|e| {
        ProcessingError::NonRetryable(DetailedError {
            reason: FailureReason::GmailApiFailed,
            source: e.context("Failed to fetch attachment data from Gmail"),
        })
    })?;

    Ok(())
}

/// Checks the database to see if a document has already been created for this attachment.
async fn attachment_document_exists(
    ctx: &PubSubContext,
    link_id: Uuid,
    attachment_db_id: Uuid,
) -> Result<bool, ProcessingError> {
    let document_id = email_db_client::attachments::provider::get_document_id_by_attachment_id(
        &ctx.db,
        link_id,
        attachment_db_id,
    )
    .await
    .map_err(|e| {
        ProcessingError::NonRetryable(DetailedError {
            reason: FailureReason::DatabaseQueryFailed,
            source: e.context("Failed to query for document email record"),
        })
    })?;

    Ok(document_id.is_some())
}
