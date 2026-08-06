use crate::pubsub::gmail_ops::process::{check_gmail_rate_limit, fetch_gmail_token};
use crate::pubsub::gmail_ops::worker::GmailOpsContext;
use models_email::gmail::filters::{Filter, FilterAction, FilterCriteria};
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

    let filters = ctx
        .gmail_client
        .list_filters(&gmail_access_token)
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::GmailApiFailed,
                source: anyhow::anyhow!("Failed to check existing block filters: {}", e),
            })
        })?;

    let is_already_blocked = filters.iter().any(|filter| {
        filter
            .criteria
            .from
            .as_deref()
            .is_some_and(|from| from.eq_ignore_ascii_case(&payload.email_address))
            && filter
                .action
                .add_label_ids
                .as_ref()
                .is_some_and(|labels| labels.iter().any(|label| label == "TRASH"))
    });
    if is_already_blocked {
        tracing::debug!("Sender is already blocked, skipping");
        return Ok(());
    }

    let filter = Filter {
        id: None,
        criteria: FilterCriteria {
            from: Some(payload.email_address.clone()),
            to: None,
            subject: None,
            query: None,
            negated_query: None,
            has_attachment: None,
            exclude_chats: None,
        },
        action: FilterAction {
            add_label_ids: Some(vec!["TRASH".to_string()]),
            remove_label_ids: None,
            forward: None,
        },
    };
    ctx.gmail_client
        .create_filter(&gmail_access_token, filter)
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::GmailApiFailed,
                source: anyhow::anyhow!("Failed to block sender in Gmail: {}", e),
            })
        })?;

    Ok(())
}
