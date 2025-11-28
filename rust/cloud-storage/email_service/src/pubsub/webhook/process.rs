use crate::pubsub::context::PubSubContext;
use crate::pubsub::webhook::error_handlers::prefix_error_source;
use crate::pubsub::webhook::operations::delete_message::delete_message;
use crate::pubsub::webhook::operations::gmail_message::gmail_message;
use crate::pubsub::webhook::operations::update_labels::update_labels;
use crate::pubsub::webhook::operations::upsert_message::upsert_message;
use anyhow::{Context, Result, anyhow};
use models_email::email::service::cache;
use models_email::email::service::link::UserProvider;
use models_email::gmail::webhook::{WebhookOperation, WebhookPubsubMessage};
use models_email::service::link::Link;
use models_email::service::pubsub::{DetailedError, FailureReason, ProcessingError};
use sqs_worker::cleanup_message;
use std::result;

/// Processes a message from the gmail webhook queue.
pub async fn process_message(
    ctx: PubSubContext,
    message: &aws_sdk_sqs::types::Message,
) -> Result<()> {
    // malformed json is not retryable
    let data = match extract_webhook_message(message) {
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
            crate::pubsub::webhook::error_handlers::handle_non_retryable_error(
                &ctx, message, &data, &e,
            )
            .await
        }

        // A temporary failure occurred. We log it and don't clean up the message, so it gets retried
        Err(ProcessingError::Retryable(e)) => {
            crate::pubsub::webhook::error_handlers::handle_retryable_error(&data, &e).await
        }
    }
}

#[tracing::instrument(skip(ctx))]
async fn inner_process_message(
    ctx: &PubSubContext,
    data: &WebhookPubsubMessage,
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
        WebhookOperation::GmailMessage(payload) => {
            gmail_message(ctx, &link, payload)
                .await
                .map_err(|e| prefix_error_source(e, "gmail_message"))?;
            tracing::debug!("Successfully processed gmail message operation");
        }
        WebhookOperation::UpsertMessage(payload) => {
            upsert_message(ctx, &link, payload)
                .await
                .map_err(|e| prefix_error_source(e, "upsert_message"))?;
            tracing::debug!("Successfully processed upsert message operation");
        }
        WebhookOperation::DeleteMessage(payload) => {
            delete_message(ctx, &link, payload)
                .await
                .map_err(|e| prefix_error_source(e, "delete_message"))?;
            tracing::debug!("Successfully processed delete message operation");
        }
        WebhookOperation::UpdateLabels(payload) => {
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
fn extract_webhook_message(
    message: &aws_sdk_sqs::types::Message,
) -> anyhow::Result<WebhookPubsubMessage> {
    let message_body = message.body().context("message body not found")?;

    // Deserialize the JSON string into a BackfillPubsubMessage
    let backfill_message: WebhookPubsubMessage = serde_json::from_str(message_body)
        .context("Failed to deserialize message body to WebhookOperation")?;

    Ok(backfill_message)
}

pub async fn fetch_pubsub_gmail_token(
    ctx: &PubSubContext,
    link: &Link,
) -> result::Result<String, ProcessingError> {
    let cache_key = cache::TokenCacheKey::new(
        &link.fusionauth_user_id,
        link.macro_id.0.as_ref(),
        UserProvider::Gmail,
    );

    let gmail_access_token = crate::util::gmail::auth::fetch_gmail_access_token(
        &cache_key,
        &ctx.redis_client,
        &ctx.auth_service_client,
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
