use crate::pubsub::link_manager::context::LinkManagerContext;
use crate::util::gmail::auth::{
    fetch_gmail_access_token_from_link, fetch_token_or_delete_on_revocation,
};
use crate::util::sync_contacts::sync_contacts;
use anyhow::{Context, anyhow};
use models_email::email::service::pubsub::LinkManagerMessage;
use models_email::service::cache::TokenCacheKey;
use models_email::service::link::{Link, UserProvider};
use models_email::service::pubsub::LinkManagerOperation;
use sqs_client::search::SearchQueueMessage;
use sqs_client::search::email::EmailLinkMessage;
use sqs_worker::cleanup_message;

#[tracing::instrument(skip(ctx, message), err)]
pub async fn process_message(
    ctx: LinkManagerContext,
    message: &aws_sdk_sqs::types::Message,
) -> anyhow::Result<()> {
    // Step 1: Parse the incoming message
    let notification_data = extract_message(message)?;

    // Step 2: Fetch the user's link details from the database
    let link =
        email_db_client::links::get::fetch_link_by_id(&ctx.db, notification_data.link_id).await?;

    let Some(link) = link else {
        tracing::debug!(link_id=%notification_data.link_id, "Link not found - skipping");
        cleanup_message(&ctx.sqs_worker, message).await?;
        return Ok(());
    };

    // Step 3: Execute the appropriate operation
    match notification_data.operation {
        LinkManagerOperation::Refresh => {
            // Access token is required for refresh - fail if we can't get it
            let gmail_access_token = fetch_token_or_delete_on_revocation(
                &link,
                &ctx.redis_client,
                &ctx.auth_service_client,
                &ctx.sqs_client,
            )
            .await?;
            handle_refresh(&ctx, &link, &gmail_access_token).await?;
        }
        LinkManagerOperation::Delete => {
            // Access token is optional for delete - we still want to clean up the database
            // even if the user has revoked access. don't delete on revocation -> infinite loop
            let gmail_access_token = fetch_gmail_access_token_from_link(
                &link,
                &ctx.redis_client,
                &ctx.auth_service_client,
            )
            .await
            .ok();
            handle_delete(&ctx, &link, gmail_access_token.as_deref()).await?;
        }
    }

    // Step 4: Cleanup the message from the queue
    cleanup_message(&ctx.sqs_worker, message).await?;

    Ok(())
}

/// Handles the Refresh operation: renews Gmail watch subscription and syncs contacts.
#[tracing::instrument(skip(ctx, gmail_access_token), fields(link = ?link), err)]
async fn handle_refresh(
    ctx: &LinkManagerContext,
    link: &Link,
    gmail_access_token: &str,
) -> anyhow::Result<()> {
    // Renew the Gmail watch subscription to ensure we keep getting updates.
    // We can proceed with contact sync even if this fails, so we'll just log the error.
    renew_gmail_watch(ctx, gmail_access_token, link)
        .await
        .inspect_err(|e| {
            tracing::error!(error=?e, "Failed to renew Gmail watch");
        })
        .ok();

    // Sync contacts and update sync tokens in the database
    if let Err(e) = sync_contacts(
        link,
        &ctx.db,
        &ctx.gmail_client,
        &ctx.sqs_client,
        gmail_access_token,
    )
    .await
    {
        tracing::error!(
            error = ?e,
            "Failed to sync contacts"
        );
    }

    // Even if above steps fail due to transient errors, we can just try again when this is
    // triggered for the user in 24h.
    Ok(())
}

/// notifies downstream dependencies of link deletion, and deletes link (and all data) from database
#[tracing::instrument(skip(ctx, gmail_access_token), fields(link = ?link), err)]
async fn handle_delete(
    ctx: &LinkManagerContext,
    link: &Link,
    gmail_access_token: Option<&str>,
) -> anyhow::Result<()> {
    tracing::info!("Deleting link");
    // set sync status to false so any future inbox updates get ignored
    email_db_client::links::update::update_link_sync_status(&ctx.db, link.id, false)
        .await
        .context("Failed to update link sync status")?;

    // cancel any running backfill jobs
    email_db_client::backfill::job::update::cancel_active_jobs_by_link_id(&ctx.db, link.id)
        .await
        .inspect_err(|e| {
            tracing::error!(error=?e, "Failed to update backfill job statuses");
        })
        .ok();

    // delete cached access token, in case user re-enables within cache window
    ctx.redis_client
        .delete_gmail_access_token(&TokenCacheKey {
            fusion_user_id: link.fusionauth_user_id.clone(),
            macro_id: link.macro_id.to_string(),
            provider: UserProvider::Gmail,
        })
        .await
        .inspect_err(|e| {
            tracing::warn!(error=?e, "Failed to delete Gmail access token");
        })
        .ok();

    // make call to gmail to unregister. may fail if the user revoked our access (which is a reason
    // that we may be deleting their link in the first place)
    if let Some(token) = gmail_access_token {
        if let Err(e) = ctx.gmail_client.stop_watch(token).await {
            tracing::warn!(error=?e, "Gmail call to stop watch failed");
        }
    } else {
        tracing::debug!("Skipping Gmail stop_watch - no access token available");
    }

    // remove google fusionauth link with gmail inbox permissions
    let _ = ctx
        .auth_service_client
        .remove_link(
            &link.fusionauth_user_id,
            link.macro_id.as_ref(),
            "google_gmail",
        )
        .await
        .inspect_err(|e| {
            tracing::error!(error=?e, "unable to unlink idp");
        });

    // inform search of deletion so it can wipe the email records from OS
    ctx.sqs_client
        .send_message_to_search_event_queue(SearchQueueMessage::RemoveEmailLink(EmailLinkMessage {
            link_id: link.id.to_string(),
            macro_user_id: link.macro_id.to_string(),
        }))
        .await
        .inspect_err(|e| {
            tracing::error!(error=?e, "failed to send message to search extractor queue");
        })
        .ok();

    // finally, delete all the user's link as well as all of their email data in a big cascading delete
    email_db_client::links::delete::delete_link_by_id(&ctx.db, link.id)
        .await
        .context("Failed to delete link in background task")?;

    tracing::info!("Successfully deleted link");

    Ok(())
}

#[tracing::instrument(skip(message))]
fn extract_message(message: &aws_sdk_sqs::types::Message) -> anyhow::Result<LinkManagerMessage> {
    let message_body = message.body().context("message body not found")?;

    serde_json::from_str(message_body)
        .context("Failed to deserialize message body to LinkManagerMessage")
}

/// Calls the Gmail API to renew the watch subscription for inbox updates.
async fn renew_gmail_watch(
    ctx: &LinkManagerContext,
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
