use crate::pubsub::gmail_ops::process::{check_gmail_rate_limit, fetch_gmail_token};
use crate::pubsub::gmail_ops::worker::GmailOpsContext;
use models_email::gmail::gmail_ops::UnblockSenderPayload;
use models_email::gmail::operations::GmailApiOperation;
use models_email::service::link::Link;
use models_email::service::pubsub::{DetailedError, FailureReason, ProcessingError};

/// Finds and removes a block filter for a sender in Gmail.
#[tracing::instrument(skip(ctx, link), err)]
pub async fn unblock_sender(
    ctx: &GmailOpsContext,
    link: &Link,
    payload: &UnblockSenderPayload,
) -> Result<(), ProcessingError> {
    check_gmail_rate_limit(
        ctx,
        link.id,
        GmailApiOperation::SettingsFiltersDelete,
        models_email::gmail::gmail_ops::GmailOpsOperation::UnblockSender(payload.clone()),
    )
    .await?;

    let gmail_access_token = fetch_gmail_token(ctx, link).await?;

    let result = ctx
        .gmail_client
        .unblock_sender(&gmail_access_token, &payload.email_address)
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::GmailApiFailed,
                source: anyhow::anyhow!("Failed to unblock sender in Gmail: {}", e),
            })
        })?;

    if !result {
        tracing::warn!("No block filter found for sender in Gmail");
    }

    Ok(())
}
