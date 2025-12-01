use crate::pubsub::context::PubSubContext;
use crate::pubsub::util::{
    cg_refresh_email, check_gmail_rate_limit, complete_transaction_with_processing_error,
};
use crate::pubsub::webhook::process;
use email_db_client::labels::delete::delete_db_message_labels;
use email_db_client::labels::insert;
use email_db_client::threads::update::update_thread_metadata;
use models_email::email::service::link;
use models_email::gmail::operations::GmailApiOperation;
use models_email::gmail::webhook::UpdateLabelsPayload;
use models_email::service;
use models_email::service::pubsub::{DetailedError, FailureReason, ProcessingError};
use sqlx::PgPool;
use std::result;
use uuid::Uuid;

/// Compares a db message's labels to the gmail message's labels, adding/removing as necessary
#[tracing::instrument(skip(ctx))]
pub async fn update_labels(
    ctx: &PubSubContext,
    link: &link::Link,
    payload: &UpdateLabelsPayload,
) -> result::Result<(), ProcessingError> {
    let gmail_access_token = process::fetch_pubsub_gmail_token(ctx, link).await?;
    let provider_message_id = &payload.provider_message_id;

    // fetch simple message to get db_id from provider_id
    let db_message =
        email_db_client::messages::get_simple_messages::get_simple_message_by_provider_and_link(
            &ctx.db,
            provider_message_id,
            &link.id,
        )
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e.context("Failed to get simple message from db".to_string()),
            })
        })?
        .ok_or_else(|| {
            ProcessingError::NonRetryable(DetailedError {
                reason: FailureReason::MessageNotFoundInProvider,
                source: anyhow::anyhow!("Message not found in database: {}", provider_message_id),
            })
        })?;

    let db_message_labels =
        email_db_client::labels::get::fetch_message_labels(&ctx.db, db_message.db_id)
            .await
            .map_err(|e| {
                ProcessingError::Retryable(DetailedError {
                    reason: FailureReason::DatabaseQueryFailed,
                    source: e.context("Failed to get message labels from db".to_string()),
                })
            })?;

    check_gmail_rate_limit(
        &ctx.redis_client,
        link.id,
        GmailApiOperation::MessagesGet,
        false,
    )
    .await?;
    let gmail_message_labels = match ctx
        .gmail_client
        .get_message_label_ids(&gmail_access_token, &payload.provider_message_id, link.id)
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::GmailApiFailed,
                source: e.context("Failed to get message from gmail api".to_string()),
            })
        })? {
        Some(labels) => labels,
        None => {
            tracing::debug!(provider_message_id = %payload.provider_message_id, link_id = %link.id,
                "Message not found in gmail when attempting to update labels");
            return Ok(());
        }
    };

    let labels_to_add: Vec<String> = gmail_message_labels
        .iter()
        .filter(|gmail_label| {
            !db_message_labels
                .iter()
                .any(|db_label| &db_label.provider_label_id == *gmail_label)
        })
        .cloned()
        .collect();

    let labels_to_delete: Vec<String> = db_message_labels
        .iter()
        .filter(|db_label| !gmail_message_labels.contains(&db_label.provider_label_id))
        .map(|label| label.provider_label_id.clone())
        .collect();

    let has_label_changes = !labels_to_add.is_empty() || !labels_to_delete.is_empty();

    if !labels_to_add.is_empty() {
        add_message_labels(
            &ctx.db,
            link,
            db_message.db_id,
            db_message.thread_db_id,
            &labels_to_add,
        )
        .await?
    }

    if !labels_to_delete.is_empty() {
        remove_message_labels(
            &ctx.db,
            link,
            db_message.db_id,
            db_message.thread_db_id,
            &labels_to_delete,
        )
        .await?
    }

    if has_label_changes {
        // tell FE to refresh user's inbox
        cg_refresh_email(
            &ctx.connection_gateway_client,
            link.macro_id.as_ref(),
            "update_labels",
        )
        .await;
    }

    Ok(())
}

#[tracing::instrument(skip(db, link))]
pub async fn add_message_labels(
    db: &PgPool,
    link: &link::Link,
    message_db_id: Uuid,
    thread_db_id: Uuid,
    provider_label_ids: &[String],
) -> result::Result<(), ProcessingError> {
    // transaction as we might be making multiple changes
    let mut tx = db.begin().await.map_err(|e| {
        ProcessingError::Retryable(DetailedError {
            reason: FailureReason::DatabaseQueryFailed,
            source: anyhow::Error::from(e).context("Failed to begin transaction"),
        })
    })?;

    let result = async {
        insert::insert_message_labels(&mut tx, link.id, message_db_id, provider_label_ids, false)
            .await
            .map_err(|e| {
                ProcessingError::Retryable(DetailedError {
                    reason: FailureReason::DatabaseQueryFailed,
                    source: e.context("Failed to insert message labels".to_string()),
                })
            })?;

        // if we are adding unread label, mark message as not read
        if provider_label_ids
            .iter()
            .any(|provider_id| provider_id == service::label::system_labels::UNREAD)
        {
            email_db_client::messages::update::update_message_read_status(
                &mut tx,
                message_db_id,
                &link.fusionauth_user_id,
                false,
            )
            .await
            .map_err(|e| {
                ProcessingError::Retryable(DetailedError {
                    reason: FailureReason::DatabaseQueryFailed,
                    source: e.context("Failed to update message read status".to_string()),
                })
            })?;
        }

        // conditionally update thread metadata, depending on the label getting added
        if provider_label_ids.iter().any(|provider_id|
            // marking a message as INBOX could change the latest_inbound_message_ts or inbox_visible status
            provider_id == service::label::system_labels::INBOX
                // marking a message as SPAM/TRASH could change the latest_non_spam_message_ts
                || provider_id == service::label::system_labels::SPAM
                || provider_id == service::label::system_labels::TRASH
                // marking as marking a message as unread could change thread's is_read
                || provider_id == service::label::system_labels::UNREAD)
        {
            update_thread_metadata(&mut tx, thread_db_id, link.id)
                .await
                .map_err(|e| {
                    ProcessingError::Retryable(DetailedError {
                        reason: FailureReason::DatabaseQueryFailed,
                        source: e.context("Failed to update thread metadata".to_string()),
                    })
                })?;
        }

        Ok::<(), ProcessingError>(())
    }
    .await;

    complete_transaction_with_processing_error(tx, result).await
}

#[tracing::instrument(skip(db, link))]
pub async fn remove_message_labels(
    db: &PgPool,
    link: &link::Link,
    message_db_id: Uuid,
    thread_db_id: Uuid,
    provider_label_ids: &[String],
) -> result::Result<(), ProcessingError> {
    // transaction as we might be making multiple db changes
    let mut tx = db.begin().await.map_err(|e| {
        ProcessingError::Retryable(DetailedError {
            reason: FailureReason::DatabaseQueryFailed,
            source: anyhow::Error::from(e).context("Failed to begin transaction"),
        })
    })?;

    let result = async {
        delete_db_message_labels(&mut tx, message_db_id, provider_label_ids, link.id)
            .await
            .map_err(|e| {
                ProcessingError::Retryable(DetailedError {
                    reason: FailureReason::DatabaseQueryFailed,
                    source: e.context("Failed to delete message labels"),
                })
            })?;

        // if we are removing unread label, mark message as read
        if provider_label_ids
            .iter()
            .any(|provider_id| provider_id == service::label::system_labels::UNREAD)
        {
            email_db_client::messages::update::update_message_read_status(
                &mut tx,
                message_db_id,
                &link.fusionauth_user_id,
                true,
            )
            .await
            .map_err(|e| {
                ProcessingError::Retryable(DetailedError {
                    reason: FailureReason::DatabaseQueryFailed,
                    source: e.context("Failed to update message read status"),
                })
            })?;
        }

        // conditionally update thread metadata, depending on the label getting added
        if provider_label_ids.iter().any(|provider_id| {
            provider_id == service::label::system_labels::INBOX
                || provider_id == service::label::system_labels::SPAM
                || provider_id == service::label::system_labels::TRASH
                || provider_id == service::label::system_labels::UNREAD
        }) {
            update_thread_metadata(&mut tx, thread_db_id, link.id)
                .await
                .map_err(|e| {
                    ProcessingError::Retryable(DetailedError {
                        reason: FailureReason::DatabaseQueryFailed,
                        source: e.context("Failed to update thread metadata"),
                    })
                })?;
        }

        Ok::<(), ProcessingError>(())
    }
    .await;

    complete_transaction_with_processing_error(tx, result).await
}
