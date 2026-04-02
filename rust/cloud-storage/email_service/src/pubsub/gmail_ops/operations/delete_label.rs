use crate::pubsub::gmail_ops::process::{check_gmail_rate_limit, fetch_gmail_token};
use crate::pubsub::gmail_ops::worker::GmailOpsContext;
use models_email::gmail::gmail_ops::DeleteLabelPayload;
use models_email::gmail::operations::GmailApiOperation;
use models_email::service::link::Link;
use models_email::service::pubsub::{DetailedError, FailureReason, ProcessingError};

/// Deletes a label from Gmail.
#[tracing::instrument(skip(ctx, link), err)]
pub async fn delete_label(
    ctx: &GmailOpsContext,
    link: &Link,
    payload: &DeleteLabelPayload,
) -> Result<(), ProcessingError> {
    check_gmail_rate_limit(
        ctx,
        link.id,
        GmailApiOperation::LabelsDelete,
        models_email::gmail::gmail_ops::GmailOpsOperation::DeleteLabel(payload.clone()),
    )
    .await?;

    let gmail_access_token = fetch_gmail_token(ctx, link).await?;

    match ctx
        .gmail_client
        .delete_label(&gmail_access_token, &payload.provider_label_id)
        .await
    {
        Ok(()) => {}
        Err(models_email::gmail::error::GmailError::NotFound(_)) => {
            tracing::warn!(
                provider_label_id = %payload.provider_label_id,
                "Label not found in Gmail when attempting to delete, ignoring"
            );
        }
        Err(e) => {
            return Err(ProcessingError::Retryable(DetailedError {
                reason: FailureReason::GmailApiFailed,
                source: anyhow::anyhow!("Failed to delete label from Gmail: {}", e),
            }));
        }
    }

    Ok(())
}
