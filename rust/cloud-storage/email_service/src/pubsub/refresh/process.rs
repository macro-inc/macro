use crate::pubsub::refresh::context::RefreshContext;
use crate::pubsub::util::{fetch_access_token_for_link, fetch_link};
use crate::util::sync_contacts::sync_contacts;
use anyhow::{Context, anyhow};
use models_email::email::service::pubsub::RefreshMessage;
use models_email::service::link::Link;
use sqs_worker::cleanup_message;
// --- Main Orchestrator Function ---

/// Processes a refresh message by orchestrating data fetching, API calls, and database updates.
pub async fn process_message(
    ctx: RefreshContext,
    message: &aws_sdk_sqs::types::Message,
) -> anyhow::Result<()> {
    // Step 1: Parse the incoming message
    let notification_data = extract_refresh_message(message)?;

    // Step 2: Fetch the user's link details from the database
    let link = fetch_link(&ctx.db, notification_data.link_id).await?;

    // Step 3: Get a valid Gmail access token
    let gmail_access_token =
        fetch_access_token_for_link(&ctx.redis_client, &ctx.auth_service_client, &link).await?;

    // Step 4: Renew the Gmail watch subscription to ensure we keep getting updates.
    // We can proceed with contact sync even if this fails, so we'll just log the error.
    if let Err(e) = renew_gmail_watch(&ctx, &gmail_access_token, &link).await {
        tracing::error!(
            error = ?e,
            link_id = %link.id,
            "Failed to renew Gmail watch"
        );
    }

    // Step 5: Sync contacts and update sync tokens in the database
    if let Err(e) = sync_contacts(
        &link,
        &ctx.db,
        &ctx.gmail_client,
        &ctx.sqs_client,
        &gmail_access_token,
    )
    .await
    {
        tracing::error!(
            error = ?e,
            link_id = %link.id,
            "Failed to sync contacts"
        );
    };

    // Step 6: Even if above steps fail due to transient errors, we can just try again when this is
    // triggered for the user in 24h.
    cleanup_message(&ctx.sqs_worker, message).await?;

    Ok(())
}

#[tracing::instrument(skip(message))]
fn extract_refresh_message(
    message: &aws_sdk_sqs::types::Message,
) -> anyhow::Result<RefreshMessage> {
    let message_body = message.body().context("message body not found")?;

    serde_json::from_str(message_body)
        .context("Failed to deserialize message body to RefreshMessage")
}

/// Calls the Gmail API to renew the watch subscription for inbox updates.
async fn renew_gmail_watch(
    ctx: &RefreshContext,
    gmail_access_token: &str,
    link: &Link,
) -> anyhow::Result<()> {
    // We ignore the result of the watch call itself, but map the error for logging.
    let _ = ctx
        .gmail_client
        .register_watch(gmail_access_token)
        .await
        .map_err(|e| {
            let error_message = "Unable to register Gmail watch";
            tracing::error!(
                error = ?e,
                email = %link.macro_id,
                provider = ?link.provider,
                error_message
            );
            anyhow!(error_message)
        });
    Ok(())
}
