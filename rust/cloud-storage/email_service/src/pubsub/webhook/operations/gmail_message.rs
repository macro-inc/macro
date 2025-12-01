use crate::pubsub::context::PubSubContext;
use crate::pubsub::util::check_gmail_rate_limit;
use crate::pubsub::webhook::process::fetch_pubsub_gmail_token;
use crate::util::process_pre_insert::sync_labels::sync_labels;
use models_email::gmail::history::InboxChanges;
use models_email::gmail::operations::GmailApiOperation;
use models_email::gmail::webhook::{
    DeleteMessagePayload, GmailMessagePayload, UpdateLabelsPayload, UpsertMessagePayload,
    WebhookOperation, WebhookPubsubMessage,
};
use models_email::service::link::{Link, UserProvider};
use models_email::service::pubsub::{DetailedError, FailureReason, ProcessingError};
use std::result;
use uuid::Uuid;

// handle the initial message received from gmail notifying us of inbox changes.
// ensure the message is valid, then send off pubsub messages for each change.
#[tracing::instrument(skip(ctx))]
pub async fn gmail_message(
    ctx: &PubSubContext,
    link: &Link,
    payload: &GmailMessagePayload,
) -> result::Result<(), ProcessingError> {
    let gmail_access_token = fetch_pubsub_gmail_token(ctx, link).await?;

    // get the user's latest history_id in the database
    // if it's GTE this message's history id, do nothing - db is already updated or being updated
    let db_history_id = email_db_client::histories::fetch_history_id_for_link(
        &ctx.db,
        link.email_address.0.as_ref(),
        UserProvider::Gmail,
    )
    .await
    .map_err(|e| {
        ProcessingError::Retryable(DetailedError {
            reason: FailureReason::DatabaseQueryFailed,
            source: e.context("Failed to fetch history id from db".to_string()),
        })
    })?
    .ok_or_else(|| {
        ProcessingError::NonRetryable(DetailedError {
            reason: FailureReason::DatabaseQueryFailed,
            source: anyhow::anyhow!("History id not found for user"),
        })
    })?;

    let db_history_u64 = db_history_id.parse::<u64>().map_err(|e| {
        ProcessingError::NonRetryable(DetailedError {
            reason: FailureReason::OutdatedHistoryId,
            source: anyhow::Error::from(e).context("Failed to parse current history_id as u64"),
        })
    })?;

    if db_history_u64 >= payload.history_id {
        return Ok(());
    }

    // ensure user's labels are synced before we start processing changes
    check_gmail_rate_limit(
        &ctx.redis_client,
        link.id,
        GmailApiOperation::LabelsList,
        false,
    )
    .await?;
    sync_labels(&ctx.db, &ctx.gmail_client, &gmail_access_token, link.id)
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::GmailApiFailed,
                source: e.context("Failed to sync labels"),
            })
        })?;

    // the history.list call in gmail api fetches all changes SINCE the history_id we pass to it.
    // we pass the db_history_id, aka history_id at the time of the last update. once
    // we update the database, we set the db history_id to be the message history_id
    // (the current history_id for the user)
    check_gmail_rate_limit(
        &ctx.redis_client,
        link.id,
        GmailApiOperation::HistoryList,
        false,
    )
    .await?;
    let inbox_changes = ctx
        .gmail_client
        .get_history(&gmail_access_token, &db_history_id)
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::GmailApiFailed,
                source: e.context(format!("unable to get history for link id: {}", link.id)),
            })
        })?;

    // Update the history_id in the database immediately to prevent duplicate processing.
    // The db history_id is used to determine which inbox changes need processing when
    // handling GmailMessage WebhookOperations. By updating it before processing the
    // current changes, we ensure that any new GmailMessage notifications that arrive
    // will use the latest history_id for comparison. This prevents duplicate processing
    // that could occur if we updated the history_id after processing the changes.
    email_db_client::histories::upsert_gmail_history(
        &ctx.db,
        link.id,
        &inbox_changes.current_history_id,
    )
    .await
    .map_err(|e| {
        ProcessingError::NonRetryable(DetailedError {
            reason: FailureReason::DatabaseQueryFailed,
            source: e.context("Failed to upsert gmail history".to_string()),
        })
    })?;

    // Build pubsub messages from inbox_changes
    let pubsub_messages = build_pubsub_messages(link.id, inbox_changes);

    // Send them off
    for ps_message in pubsub_messages {
        let message_for_error = ps_message.clone();
        ctx.sqs_client
            .enqueue_gmail_webhook_notification(ps_message)
            .await
            .map_err(|e| {
                ProcessingError::NonRetryable(DetailedError {
                    reason: FailureReason::SqsEnqueueFailed,
                    source: e.context(format!("Failed to enqueue message {:?}", message_for_error)),
                })
            })?;
    }

    Ok(())
}

/// Builds pubsub messages from history data
#[tracing::instrument]
fn build_pubsub_messages(link_id: Uuid, inbox_changes: InboxChanges) -> Vec<WebhookPubsubMessage> {
    let mut pubsub_messages = Vec::new();

    // Process messages to upsert
    for message_id in inbox_changes.message_ids_to_upsert {
        pubsub_messages.push(WebhookPubsubMessage {
            link_id,
            operation: WebhookOperation::UpsertMessage(UpsertMessagePayload {
                provider_message_id: message_id,
            }),
        });
    }

    // Process messages to delete
    for message_id in inbox_changes.message_ids_to_delete {
        pubsub_messages.push(WebhookPubsubMessage {
            link_id,
            operation: WebhookOperation::DeleteMessage(DeleteMessagePayload {
                provider_message_id: message_id,
            }),
        });
    }

    for message_id in inbox_changes.labels_to_update {
        pubsub_messages.push(WebhookPubsubMessage {
            link_id,
            operation: WebhookOperation::UpdateLabels(UpdateLabelsPayload {
                provider_message_id: message_id,
            }),
        });
    }

    pubsub_messages
}
