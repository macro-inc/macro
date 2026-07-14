use crate::pubsub::gmail_ops::process::{check_gmail_rate_limit, fetch_gmail_token};
use crate::pubsub::gmail_ops::worker::GmailOpsContext;
use models_email::gmail::gmail_ops::BlockSenderPayload;
use models_email::gmail::operations::GmailApiOperation;
use models_email::service::link::Link;
use models_email::service::pubsub::{DetailedError, FailureReason, ProcessingError};

/// Creates a filter to block a sender in Gmail.
#[tracing::instrument(skip(ctx, link), err)]
pub async fn block_sender(
    ctx: &GmailOpsContext,
    link: &Link,
    payload: &BlockSenderPayload,
) -> Result<(), ProcessingError> {
    check_gmail_rate_limit(
        ctx,
        link.id,
        GmailApiOperation::SettingsFiltersCreate,
        models_email::gmail::gmail_ops::GmailOpsOperation::BlockSender(payload.clone()),
    )
    .await?;

    let gmail_access_token = fetch_gmail_token(ctx, link).await?;

    // Check if already blocked
    let existing_filter = ctx
        .gmail_client
        .find_block_filter_for_sender(&gmail_access_token, &payload.email_address)
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::GmailApiFailed,
                source: anyhow::anyhow!("Failed to check existing block filters: {}", e),
            })
        })?;

    if existing_filter.is_some() {
        tracing::debug!("Sender is already blocked, skipping");
        return Ok(());
    }

    ctx.gmail_client
        .block_sender(&gmail_access_token, &payload.email_address)
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::GmailApiFailed,
                source: anyhow::anyhow!("Failed to block sender in Gmail: {}", e),
            })
        })?;

    Ok(())
}
