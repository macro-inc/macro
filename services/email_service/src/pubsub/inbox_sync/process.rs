use crate::pubsub::context::PubSubContext;
use crate::pubsub::inbox_sync::error_handlers::prefix_error_source;
use crate::pubsub::inbox_sync::operations::delete_message::delete_message;
use crate::pubsub::inbox_sync::operations::gmail_message::gmail_message;
use crate::pubsub::inbox_sync::operations::update_labels::update_labels;
use crate::pubsub::inbox_sync::operations::upsert_message::upsert_message;
use crate::util::redis::rate_limit::RateLimitArgs;
use anyhow::{Context, Result, anyhow};
use models_email::gmail::inbox_sync::{InboxSyncOperation, InboxSyncPubsubMessage};
use models_email::gmail::operations::GmailApiOperation;
use models_email::service::link::Link;
use models_email::service::pubsub::{DetailedError, FailureReason, ProcessingError};
use sqs_worker::cleanup_message;
use std::result;
use uuid::Uuid;

/// Processes a message from the gmail inbox sync queue.
pub async fn process_message(
    ctx: PubSubContext,
    message: &aws_sdk_sqs::types::Message,
) -> Result<()> {
    // malformed json is not retryable
    let data = match extract_inbox_sync_message(message) {
        Ok(data) => data,
        Err(e) => {
            tracing::error!(error = %e, "Failed to extract message, this is non-retryable.");
            if let Err(cleanup_err) = cleanup_message(&ctx.sqs_worker, message).await {
                tracing::error!(error = %cleanup_err, "Failed to clean up message after extraction error");
            }
            return Err(e);
        }
    };

    // wrapping logic in function makes error handling cleaner
    let processing_result = inner_process_message(&ctx, &data).await;

    match processing_result {
        // Processing success. Clean up the message
        Ok(()) => {
            cleanup_message(&ctx.sqs_worker, message).await?;
            Ok(())
        }

        // A permanent failure occurred. We clean up the message to prevent it from being retried
        Err(ProcessingError::NonRetryable(e)) => {
            crate::pubsub::inbox_sync::error_handlers::handle_non_retryable_error(
                &ctx, message, &data, &e,
            )
            .await
        }

        // A temporary failure occurred. We log it and don't clean up the message, so it gets retried
        Err(ProcessingError::Retryable(e)) => {
            crate::pubsub::inbox_sync::error_handlers::handle_retryable_error(&data, &e).await
        }
    }
}

#[tracing::instrument(skip(ctx))]
async fn inner_process_message(
    ctx: &PubSubContext,
    data: &InboxSyncPubsubMessage,
) -> result::Result<(), ProcessingError> {
    let link = email_db_client::links::get::fetch_link_by_id(&ctx.db, data.link_id)
        .await
        .map_err(|e| {
            ProcessingError::Retryable(DetailedError {
                reason: FailureReason::DatabaseQueryFailed,
                source: e.context("Failed to fetch link from database"),
            })
        })?
        .ok_or_else(|| {
            ProcessingError::NonRetryable(DetailedError {
                reason: FailureReason::LinkNotFound,
                source: anyhow!("No link found for id {}", data.link_id),
            })
        })?;

    // if sync is disabled we shouldn't update the user's inbox
    if !link.is_sync_active {
        return Ok(());
    }

    match &data.operation {
        InboxSyncOperation::GmailMessage(payload) => {
            gmail_message(ctx, &link, payload)
                .await
                .map_err(|e| prefix_error_source(e, "gmail_message"))?;
            tracing::debug!("Successfully processed gmail message operation");
        }
        InboxSyncOperation::UpsertMessage(payload) => {
            upsert_message(ctx, &link, payload)
                .await
                .map_err(|e| prefix_error_source(e, "upsert_message"))?;
            tracing::debug!("Successfully processed upsert message operation");
        }
        InboxSyncOperation::DeleteMessage(payload) => {
            delete_message(ctx, &link, payload)
                .await
                .map_err(|e| prefix_error_source(e, "delete_message"))?;
            tracing::debug!("Successfully processed delete message operation");
        }
        InboxSyncOperation::UpdateLabels(payload) => {
            update_labels(ctx, &link, payload)
                .await
                .map_err(|e| prefix_error_source(e, "remove_labels"))?;
            tracing::debug!("Successfully processed update labels operation");
        }
    }

    Ok(())
}

/// Extracts backfill message from the SQS message body
#[tracing::instrument(skip(message))]
fn extract_inbox_sync_message(
    message: &aws_sdk_sqs::types::Message,
) -> anyhow::Result<InboxSyncPubsubMessage> {
    let message_body = message.body().context("message body not found")?;

    // Deserialize the JSON string into a BackfillPubsubMessage
    let backfill_message: InboxSyncPubsubMessage = serde_json::from_str(message_body)
        .context("Failed to deserialize message body to InboxSyncOperation")?;

    Ok(backfill_message)
}

pub async fn fetch_pubsub_gmail_token(
    ctx: &PubSubContext,
    link: &Link,
) -> result::Result<String, ProcessingError> {
    let gmail_access_token = crate::util::gmail::auth::fetch_token_or_mark_reauth(
        link,
        &ctx.db,
        &ctx.redis_client,
        &ctx.auth_service_client,
        &ctx.sqs_client,
    )
    .await
    .map_err(|e| {
        ProcessingError::NonRetryable(DetailedError {
            reason: FailureReason::AccessTokenFetchFailed,
            source: e.context("Failed to fetch gmail access token".to_string()),
        })
    })?;
    Ok(gmail_access_token)
}

/// Checks Gmail API rate limits and routes processing accordingly.
///
/// Uses a two-tier inbox sync system to prevent rate limit backpressure:
/// - **Primary worker**: If rate limited, enqueues to retry queue and returns non-retryable error
/// - **Retry worker**: If rate limited, returns retryable error so it gets tried again later
///
/// This design keeps the primary queue flowing by offloading rate-limited operations to a
/// separate retry queue, preventing head-of-line blocking.
pub async fn check_gmail_rate_limit_inbox_sync(
    ctx: &PubSubContext,
    link_id: Uuid,
    operation: GmailApiOperation,
    sync_operation: InboxSyncOperation,
) -> result::Result<(), ProcessingError> {
    if !ctx
        .redis_client
        .is_rate_limited(RateLimitArgs {
            user_id: link_id,
            operation,
            is_backfill: false,
        })
        .await
    {
        // Not rate limited, continue processing
        return Ok(());
    }

    if !ctx.retry_worker {
        ctx.sqs_client
            .enqueue_gmail_retry_inbox_sync_notification(InboxSyncPubsubMessage {
                link_id,
                operation: sync_operation,
            })
            .await
            .map_err(|e| {
                ProcessingError::NonRetryable(DetailedError {
                    reason: FailureReason::SqsEnqueueFailed,
                    source: e.context("Failed to enqueue retry message"),
                })
            })?;
        Err(ProcessingError::NonRetryable(DetailedError {
            reason: FailureReason::GmailApiRateLimited,
            source: anyhow::Error::msg(
                "Gmail API rate limit exceeded, enqueued message on retry queue",
            ),
        }))
    } else {
        Err(ProcessingError::Retryable(DetailedError {
            reason: FailureReason::GmailApiRateLimited,
            source: anyhow::Error::msg("Gmail API rate limit exceeded in retry worker"),
        }))
    }
}
