use crate::pubsub::gmail_ops::process::{check_gmail_rate_limit, fetch_gmail_token};
use crate::pubsub::gmail_ops::worker::GmailOpsContext;
use anyhow::Context;
use models_email::gmail::error::GmailError;
use models_email::gmail::gmail_ops::ModifyMessageLabelsPayload;
use models_email::gmail::operations::GmailApiOperation;
use models_email::service;
use models_email::service::link::Link;
use models_email::service::pubsub::{DetailedError, FailureReason, ProcessingError};

/// Modifies labels for a single message in Gmail. Reverts DB changes on permanent failure.
/// Transient errors (5xx, network) are retried; permanent errors (4xx) trigger revert.
#[tracing::instrument(skip(ctx, link), err)]
pub async fn modify_message_labels(
    ctx: &GmailOpsContext,
    link: &Link,
    payload: &ModifyMessageLabelsPayload,
) -> Result<(), ProcessingError> {
    check_gmail_rate_limit(
        ctx,
        link.id,
        GmailApiOperation::MessagesModify,
        models_email::gmail::gmail_ops::GmailOpsOperation::ModifyMessageLabels(payload.clone()),
    )
    .await?;

    let gmail_access_token = fetch_gmail_token(ctx, link).await?;

    let result = ctx
        .gmail_client
        .modify_message_labels(
            &gmail_access_token,
            &payload.provider_message_id,
            &payload.labels_to_add,
            &payload.labels_to_remove,
        )
        .await;

    match result {
        Ok(()) => Ok(()),
        Err(
            e @ (GmailError::ServerError(..)
            | GmailError::HttpRequest(_)
            | GmailError::RateLimitExceeded),
        ) => {
            tracing::warn!(
                error = ?e,
                db_message_id = %payload.db_message_id,
                provider_message_id = %payload.provider_message_id,
                "Transient Gmail error modifying labels, will retry"
            );
            Err(ProcessingError::Retryable(DetailedError {
                reason: FailureReason::GmailApiFailed,
                source: anyhow::anyhow!("{}", e),
            }))
        }
        Err(e) => {
            tracing::error!(
                error = ?e,
                db_message_id = %payload.db_message_id,
                provider_message_id = %payload.provider_message_id,
                "Permanent Gmail error modifying labels, reverting database changes"
            );

            revert_db_changes(ctx, link, payload).await;

            Err(ProcessingError::NonRetryable(DetailedError {
                reason: FailureReason::GmailApiFailed,
                source: anyhow::anyhow!("{}", e),
            }))
        }
    }
}

/// Reverts the optimistic DB changes for a single message that failed in Gmail.
/// Derives revert context from the link and payload.
async fn revert_db_changes(
    ctx: &GmailOpsContext,
    link: &Link,
    payload: &ModifyMessageLabelsPayload,
) {
    let mut tx = match ctx.db.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::error!(error=?e, "Failed to begin transaction for reversion");
            return;
        }
    };

    let failed_ids = vec![payload.db_message_id];
    let is_adding = !payload.labels_to_add.is_empty();

    let Some(provider_label_id) = (if is_adding {
        payload.labels_to_add.first()
    } else {
        payload.labels_to_remove.first()
    }) else {
        tracing::error!("No label IDs in payload, cannot revert");
        return;
    };

    let revert_result = async {
        if is_adding {
            email_db_client::labels::delete::delete_message_labels_batch(
                &mut *tx,
                &failed_ids,
                provider_label_id,
                link.id,
            )
            .await
            .context("Failed to revert adding labels")?;
        } else {
            email_db_client::labels::insert::insert_message_labels_batch(
                &mut *tx,
                &failed_ids,
                provider_label_id,
                link.id,
            )
            .await
            .context("Failed to revert removing labels")?;
        }

        if *provider_label_id == service::label::system_labels::UNREAD {
            email_db_client::messages::update::update_message_read_status_batch(
                &mut *tx,
                failed_ids.clone(),
                &link.fusionauth_user_id,
                is_adding,
            )
            .await
            .context("Failed to revert message read status")?;
        } else if *provider_label_id == service::label::system_labels::STARRED {
            email_db_client::messages::update::update_message_starred_status_batch(
                &mut *tx,
                failed_ids,
                &link.fusionauth_user_id,
                !is_adding,
            )
            .await
            .context("Failed to revert message starred status")?;
        }

        anyhow::Ok(())
    }
    .await;

    match revert_result {
        Ok(_) => {
            if let Err(e) = tx.commit().await {
                tracing::error!(error=?e, "Unable to commit transaction for revert");
            } else {
                tracing::info!(
                    db_message_id = %payload.db_message_id,
                    "Successfully reverted database changes after Gmail API failure"
                );
            }
        }
        Err(e) => {
            tracing::error!(error=?e, "Revert failed, rolling back");
            if let Err(rollback_err) = tx.rollback().await {
                tracing::error!(error=?rollback_err, "Failed to rollback revert transaction");
            }
        }
    }
}
