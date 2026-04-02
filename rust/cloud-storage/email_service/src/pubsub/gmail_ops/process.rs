use crate::pubsub::gmail_ops::error_handlers::prefix_error_source;
use crate::pubsub::gmail_ops::operations::block_sender::block_sender;
use crate::pubsub::gmail_ops::operations::delete_label::delete_label;
use crate::pubsub::gmail_ops::operations::modify_message_labels::modify_message_labels;
use crate::pubsub::gmail_ops::operations::unblock_sender::unblock_sender;
use crate::pubsub::gmail_ops::worker::GmailOpsContext;
use crate::util::redis::rate_limit::RateLimitArgs;
use anyhow::{Context, Result, anyhow};
use models_email::gmail::gmail_ops::{GmailOpsOperation, GmailOpsPubsubMessage};
use models_email::gmail::operations::GmailApiOperation;
use models_email::service::link::Link;
use models_email::service::pubsub::{DetailedError, FailureReason, ProcessingError};
use sqs_worker::cleanup_message;
use uuid::Uuid;

/// Processes a message from the gmail ops queue.
pub async fn process_message(
    ctx: GmailOpsContext,
    message: &aws_sdk_sqs::types::Message,
) -> Result<()> {
    let data = match extract_gmail_ops_message(message) {
        Ok(data) => data,
        Err(e) => {
            tracing::error!(error = %e, "Failed to extract gmail ops message, this is non-retryable.");
            if let Err(cleanup_err) = cleanup_message(&ctx.sqs_worker, message).await {
                tracing::error!(error = %cleanup_err, "Failed to clean up message after extraction error");
            }
            return Err(e);
        }
    };

    let processing_result = inner_process_message(&ctx, &data).await;

    match processing_result {
        Ok(()) => {
            cleanup_message(&ctx.sqs_worker, message).await?;
            Ok(())
        }
        Err(ProcessingError::NonRetryable(e)) => {
            crate::pubsub::gmail_ops::error_handlers::handle_non_retryable_error(
                &ctx, message, &data, &e,
            )
            .await
        }
        Err(ProcessingError::Retryable(e)) => {
            crate::pubsub::gmail_ops::error_handlers::handle_retryable_error(&data, &e).await
        }
    }
}

#[tracing::instrument(skip(ctx, data), err)]
async fn inner_process_message(
    ctx: &GmailOpsContext,
    data: &GmailOpsPubsubMessage,
) -> Result<(), ProcessingError> {
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

    match &data.operation {
        GmailOpsOperation::ModifyMessageLabels(payload) => {
            modify_message_labels(ctx, &link, payload)
                .await
                .map_err(|e| prefix_error_source(e, "modify_message_labels"))?;
            tracing::debug!("Successfully processed modify message labels operation");
        }
        GmailOpsOperation::DeleteLabel(payload) => {
            delete_label(ctx, &link, payload)
                .await
                .map_err(|e| prefix_error_source(e, "delete_label"))?;
            tracing::debug!("Successfully processed delete label operation");
        }
        GmailOpsOperation::BlockSender(payload) => {
            block_sender(ctx, &link, payload)
                .await
                .map_err(|e| prefix_error_source(e, "block_sender"))?;
            tracing::debug!("Successfully processed block sender operation");
        }
        GmailOpsOperation::UnblockSender(payload) => {
            unblock_sender(ctx, &link, payload)
                .await
                .map_err(|e| prefix_error_source(e, "unblock_sender"))?;
            tracing::debug!("Successfully processed unblock sender operation");
        }
    }

    Ok(())
}

/// Extracts the message from the SQS message body.
#[tracing::instrument(skip(message))]
fn extract_gmail_ops_message(
    message: &aws_sdk_sqs::types::Message,
) -> anyhow::Result<GmailOpsPubsubMessage> {
    let message_body = message.body().context("message body not found")?;
    let gmail_ops_message: GmailOpsPubsubMessage = serde_json::from_str(message_body)
        .context("Failed to deserialize message body to GmailOpsPubsubMessage")?;
    Ok(gmail_ops_message)
}

/// Fetches a Gmail access token for use in pubsub workers.
#[tracing::instrument(skip(ctx, link), err)]
pub async fn fetch_gmail_token(
    ctx: &GmailOpsContext,
    link: &Link,
) -> Result<String, ProcessingError> {
    let gmail_access_token = crate::util::gmail::auth::fetch_token_or_delete_on_revocation(
        link,
        &ctx.redis_client,
        &ctx.auth_service_client,
        &ctx.sqs_client,
    )
    .await
    .map_err(|e| {
        ProcessingError::NonRetryable(DetailedError {
            reason: FailureReason::AccessTokenFetchFailed,
            source: e.context("Failed to fetch gmail access token"),
        })
    })?;
    Ok(gmail_access_token)
}

/// Checks Gmail API rate limits and routes processing accordingly.
///
/// Uses a two-tier system to prevent rate limit backpressure:
/// - **Primary worker**: If rate limited, enqueues to retry queue and returns non-retryable error
/// - **Retry worker**: If rate limited, returns retryable error so it gets tried again later
#[tracing::instrument(skip(ctx, gmail_ops_operation), err)]
pub async fn check_gmail_rate_limit(
    ctx: &GmailOpsContext,
    link_id: Uuid,
    operation: GmailApiOperation,
    gmail_ops_operation: GmailOpsOperation,
) -> Result<(), ProcessingError> {
    if !ctx
        .redis_client
        .is_rate_limited(RateLimitArgs {
            user_id: link_id,
            operation,
            is_backfill: false,
        })
        .await
    {
        return Ok(());
    }

    if !ctx.retry_worker {
        tracing::info!(
            link_id = %link_id,
            "Gmail API rate limited, moving message from primary queue to retry queue"
        );
        ctx.sqs_client
            .enqueue_gmail_ops_retry_notification(GmailOpsPubsubMessage {
                link_id,
                operation: gmail_ops_operation,
            })
            .await
            .map_err(|e| {
                ProcessingError::Retryable(DetailedError {
                    reason: FailureReason::SqsEnqueueFailed,
                    source: e.context("Failed to enqueue gmail ops retry message"),
                })
            })?;
        Err(ProcessingError::NonRetryable(DetailedError {
            reason: FailureReason::GmailApiRateLimited,
            source: anyhow::Error::msg(
                "Gmail API rate limit exceeded, enqueued message on retry queue",
            ),
        }))
    } else {
        tracing::info!(
            link_id = %link_id,
            "Gmail API rate limited in retry worker, message will be retried after visibility timeout"
        );
        Err(ProcessingError::Retryable(DetailedError {
            reason: FailureReason::GmailApiRateLimited,
            source: anyhow::Error::msg("Gmail API rate limit exceeded in retry worker"),
        }))
    }
}
