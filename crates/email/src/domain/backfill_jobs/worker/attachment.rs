use super::*;
use crate::domain::mailbox::connection::ConnectionSourceError;
use models_email::service::{
    backfill::*,
    link,
    pubsub::{DetailedError, FailureReason, ProcessingError},
};
/// this step is invoked by the UpdateMetadata step. it uploads the specified attachment as a
/// Macro document for the user. first checks the attachment doesn't already exist by querying
/// document_email table before fetching and uploading the attachment data.
#[tracing::instrument(skip(ctx))]
pub(super) async fn backfill_attachment<R, G, Q, E, C>(
    ctx: &BackfillService<R, G, Q, E, C>,
    link: &link::Link,
    p: &BackfillAttachmentPayload,
) -> Result<(), ProcessingError>
where
    R: BackfillRepository,
    G: BackfillGmail,
    Q: BackfillQueue,
    E: BackfillEffects,
    C: BackfillCrm,
{
    // Check if a document for this attachment already exists before uploading.
    if ctx
        .repository
        .attachment_document(link.id, p.metadata.attachment_metadata.attachment_db_id)
        .await
        .map_err(|e| {
            ProcessingError::NonRetryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e
                    .into_original()
                    .context("Failed to query for document email record"),
            })
        })?
        .is_some()
    {
        return Ok(());
    }

    let attachment_args = p.metadata.clone();
    let uploaded = ctx.effects.upload(link, p).await;
    if let Err(BackfillUploadError::Deleted) = uploaded {
        tracing::info!(
            attachment_id = %attachment_args.attachment_metadata.attachment_db_id,
            "skipped attachment deleted before it could be backfilled"
        );
        return Ok(());
    }
    uploaded.map_err(|e| match e {
        BackfillUploadError::RateLimited(error) => ProcessingError::Retryable(DetailedError {
            reason: FailureReason::GmailApiRateLimited,
            source: anyhow::Error::new(error).context("Failed to upload attachment"),
        }),
        BackfillUploadError::Deleted => ProcessingError::NonRetryable(DetailedError {
            reason: FailureReason::GmailApiFailed,
            source: anyhow::Error::new(e).context("Failed to upload attachment"),
        }),
        BackfillUploadError::Failed(e) => ProcessingError::NonRetryable(DetailedError {
            reason: FailureReason::GmailApiFailed,
            source: e.context("Failed to upload attachment"),
        }),
    })?;

    Ok(())
}
