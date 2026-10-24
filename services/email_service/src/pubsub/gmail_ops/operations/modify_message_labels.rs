use crate::pubsub::gmail_ops::email_api_error::is_permanent_mutation_error;
use crate::pubsub::gmail_ops::worker::GmailOpsContext;
use anyhow::Context;
use email_api_client::domain::models::EmailApiError;
use models_email::gmail::gmail_ops::ModifyMessageLabelsBatchPayload;
use models_email::service;
use models_email::service::link::Link;
use uuid::Uuid;

/// Modifies labels for a batch of messages in one Gmail request. Gmail
/// applies the batch as a whole, so a permanent failure reverts every message
/// in it; transient errors (5xx, network) and rate limits keep the optimistic
/// DB changes for the retry.
#[tracing::instrument(
    skip(ctx, link, payload),
    fields(
        message_count = payload.messages.len(),
        labels_to_add = ?payload.labels_to_add,
        labels_to_remove = ?payload.labels_to_remove,
    ),
    err
)]
pub async fn modify_message_labels(
    ctx: &GmailOpsContext,
    link: &Link,
    payload: &ModifyMessageLabelsBatchPayload,
) -> Result<(), EmailApiError> {
    let provider_message_ids: Vec<String> = payload
        .messages
        .iter()
        .map(|message| message.provider_message_id.clone())
        .collect();
    let db_message_ids: Vec<Uuid> = payload
        .messages
        .iter()
        .map(|message| message.db_message_id)
        .collect();
    let result = ctx
        .email_api
        .modify_message_labels(
            link.id,
            &provider_message_ids,
            &payload.labels_to_add,
            &payload.labels_to_remove,
        )
        .await;

    if let Err(error) = &result {
        if is_permanent_mutation_error(error) {
            tracing::error!(
                error = ?error,
                ?db_message_ids,
                "Permanent Gmail error modifying labels, reverting database changes"
            );
            revert_db_changes(ctx, link, payload, db_message_ids).await;
        } else {
            tracing::warn!(
                error = ?error,
                ?db_message_ids,
                "Retryable Gmail error modifying labels, preserving optimistic database changes"
            );
        }
    }

    result
}

/// Reverts the optimistic DB changes for the messages of a batch that failed
/// in Gmail.
async fn revert_db_changes(
    ctx: &GmailOpsContext,
    link: &Link,
    payload: &ModifyMessageLabelsBatchPayload,
    failed_ids: Vec<Uuid>,
) {
    let mut tx = match ctx.db.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::error!(error=?e, "Failed to begin transaction for reversion");
            return;
        }
    };

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
                &mut *tx,
                failed_ids.clone(),
                link.id,
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
                    db_message_ids = ?failed_ids,
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
