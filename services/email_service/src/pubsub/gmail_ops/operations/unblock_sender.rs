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

    let filters = ctx
        .gmail_client
        .list_filters(&gmail_access_token)
        .await
        .map_err(retryable_filter_error)?;
    let filter_id = filters.into_iter().find_map(|filter| {
        let matches_sender = filter
            .criteria
            .from
            .as_deref()
            .is_some_and(|from| from.eq_ignore_ascii_case(&payload.email_address));
        let sends_to_trash = filter
            .action
            .add_label_ids
            .as_ref()
            .is_some_and(|labels| labels.iter().any(|label| label == "TRASH"));
        (matches_sender && sends_to_trash)
            .then_some(filter.id)
            .flatten()
    });

    let Some(filter_id) = filter_id else {
        tracing::warn!("No block filter found for sender in Gmail");
        return Ok(());
    };

    ctx.gmail_client
        .delete_filter(&gmail_access_token, &filter_id)
        .await
        .map_err(retryable_filter_error)
}

fn retryable_filter_error(error: gmail_client::GmailApiHttpError) -> ProcessingError {
    ProcessingError::Retryable(DetailedError {
        reason: FailureReason::GmailApiFailed,
        source: anyhow::anyhow!("Failed to unblock sender in Gmail: {error}"),
    })
}
