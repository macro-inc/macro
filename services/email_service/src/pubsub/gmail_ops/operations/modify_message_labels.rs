use crate::pubsub::gmail_ops::email_api_error::is_permanent_mutation_error;
use crate::pubsub::gmail_ops::worker::GmailOpsContext;
use anyhow::Context;
use email_api_client::domain::models::EmailApiError;
use models_email::gmail::gmail_ops::ModifyMessageLabelsPayload;
use models_email::service;
use models_email::service::link::Link;

/// Modifies labels for a single message in Gmail. Reverts DB changes on permanent failure.
/// Transient errors (5xx, network) are retried; permanent errors (4xx) trigger revert.
#[tracing::instrument(skip(ctx, link), err)]
pub async fn modify_message_labels(
    ctx: &GmailOpsContext,
    link: &Link,
    payload: &ModifyMessageLabelsPayload,
) -> Result<(), EmailApiError> {
    let result = ctx
        .email_api
        .modify_message_labels(
            link.id,
            &payload.provider_message_id,
            &payload.labels_to_add,
            &payload.labels_to_remove,
        )
        .await;

    if let Err(error) = &result {
        if is_permanent_mutation_error(error) {
            tracing::error!(
                error = ?error,
                db_message_id = %payload.db_message_id,
                provider_message_id = %payload.provider_message_id,
                "Permanent Gmail error modifying labels, reverting database changes"
            );
            revert_db_changes(ctx, link, payload).await;
        } else {
            tracing::warn!(
                error = ?error,
                db_message_id = %payload.db_message_id,
                provider_message_id = %payload.provider_message_id,
                "Retryable Gmail error modifying labels, preserving optimistic database changes"
            );
        }
    }

    result
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
                link.id,
                is_adding,
            )
            .await
            .context("Failed to revert message read status")?;
        } else if *provider_label_id == service::label::system_labels::STARRED {
            email_db_client::messages::update::update_message_starred_status_batch(
                &mut *tx, failed_ids, link.id, !is_adding,
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
