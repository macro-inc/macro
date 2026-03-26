use crate::pubsub::gmail_ops::process::{check_gmail_rate_limit, fetch_gmail_token};
use crate::pubsub::gmail_ops::worker::GmailOpsContext;
use anyhow::Context;
use models_email::gmail::gmail_ops::ModifyMessageLabelsPayload;
use models_email::gmail::operations::GmailApiOperation;
use models_email::service;
use models_email::service::link::Link;
use models_email::service::pubsub::{DetailedError, FailureReason, ProcessingError};
use std::result;

/// Modifies labels for a single message in Gmail. Reverts DB changes on failure.
#[tracing::instrument(skip(ctx, link))]
pub async fn modify_message_labels(
    ctx: &GmailOpsContext,
    link: &Link,
    payload: &ModifyMessageLabelsPayload,
) -> result::Result<(), ProcessingError> {
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

    if let Err(e) = result {
        tracing::error!(
            error = ?e,
            db_message_id = %payload.db_message_id,
            provider_message_id = %payload.provider_message_id,
            "Failed to modify labels in Gmail, reverting database changes"
        );

        revert_db_changes(ctx, payload).await;

        return Err(ProcessingError::NonRetryable(DetailedError {
            reason: FailureReason::GmailApiFailed,
            source: anyhow::anyhow!("Failed to modify message labels in Gmail: {}", e),
        }));
    }

    Ok(())
}

/// Reverts the optimistic DB changes for a single message that failed in Gmail.
async fn revert_db_changes(ctx: &GmailOpsContext, payload: &ModifyMessageLabelsPayload) {
    let mut tx = match ctx.db.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::error!(error=?e, "Failed to begin transaction for reversion");
            return;
        }
    };

    let failed_ids = vec![payload.db_message_id];

    let revert_result = async {
        if payload.is_adding {
            email_db_client::labels::delete::delete_message_labels_batch(
                &mut *tx,
                &failed_ids,
                &payload.provider_label_id,
                payload.link_id,
            )
            .await
            .context("Failed to revert adding labels")?;
        } else {
            email_db_client::labels::insert::insert_message_labels_batch(
                &mut *tx,
                &failed_ids,
                &payload.provider_label_id,
                payload.link_id,
            )
            .await
            .context("Failed to revert removing labels")?;
        }

        if payload.provider_label_id == service::label::system_labels::UNREAD {
            email_db_client::messages::update::update_message_read_status_batch(
                &mut *tx,
                failed_ids.clone(),
                &payload.fusion_user_id,
                payload.is_adding,
            )
            .await
            .context("Failed to revert message read status")?;
        } else if payload.provider_label_id == service::label::system_labels::STARRED {
            email_db_client::messages::update::update_message_starred_status_batch(
                &mut *tx,
                failed_ids,
                &payload.fusion_user_id,
                !payload.is_adding,
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
