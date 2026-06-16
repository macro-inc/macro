use crate::pubsub::link_manager::context::LinkManagerContext;
use crate::pubsub::util::{build_notification_recipients, cg_refresh_email};
use crate::util::gmail::auth::{
    fetch_gmail_access_token_from_link, fetch_token_or_mark_reauth, is_forbidden_error,
    is_reauth_required_error,
};
use crate::util::sync_contacts::sync_contacts;
use anyhow::{Context, anyhow};
use crm::domain::service::CrmService;
use model_entity::EntityType;
use model_notifications::InboxReauthRequiredMetadata;
use models_email::api::refresh::RefreshEmailEvent;
use models_email::email::service::pubsub::{DeletionReason, LinkManagerMessage};
use models_email::service::cache::TokenCacheKey;
use models_email::service::link::{Link, UserProvider};
use notification::domain::models::SendNotificationRequestBuilder;
use notification::domain::service::NotificationIngress;
use sqs_client::search::SearchQueueMessage;
use sqs_client::search::email::EmailLinkMessage;
use sqs_worker::cleanup_message;

#[tracing::instrument(skip(ctx, message), err)]
pub async fn process_message(
    ctx: LinkManagerContext,
    message: &aws_sdk_sqs::types::Message,
) -> anyhow::Result<()> {
    let notification_data = extract_message(message)?;

    match notification_data {
        LinkManagerMessage::Refresh { link_id } => {
            let link = get_link_or_skip(&ctx, message, link_id).await?;
            let Some(link) = link else { return Ok(()) };

            match fetch_token_or_mark_reauth(
                &link,
                &ctx.db,
                &ctx.redis_client,
                &ctx.auth_service_client,
                &ctx.sqs_client,
            )
            .await
            {
                Ok(gmail_access_token) => {
                    handle_refresh(&ctx, &link, &gmail_access_token).await?;
                }
                // The grant is gone. There is nothing to refresh until the user
                // reconnects, so drop the message rather than retrying a fetch that
                // cannot succeed — but only once the reauth flag is actually
                // persisted, otherwise retry so the health signal isn't lost when the
                // mark write itself failed.
                Err(e) if is_reauth_required_error(&e) => {
                    let persisted = email_db_client::links::get::fetch_link_by_id(&ctx.db, link.id)
                        .await
                        .context("Failed to verify needs_reauth state after token fetch failure")?
                        .is_some_and(|l| l.needs_reauth);

                    if !persisted {
                        return Err(e.context("reauth required but needs_reauth not persisted"));
                    }
                }
                Err(e) => return Err(e),
            }
        }
        LinkManagerMessage::NotifyReauthRequired { link_id } => {
            let link = get_link_or_skip(&ctx, message, link_id).await?;
            let Some(link) = link else { return Ok(()) };

            handle_notify_reauth_required(&ctx, &link).await?;
        }
        LinkManagerMessage::DeleteLink {
            link_id,
            deletion_reason,
        } => {
            let link = get_link_or_skip(&ctx, message, link_id).await?;
            let Some(link) = link else { return Ok(()) };

            let gmail_access_token = fetch_teardown_token(&ctx, &link).await;
            handle_delete(&ctx, &link, gmail_access_token.as_deref(), &deletion_reason).await?;
        }
        LinkManagerMessage::DeleteUser { fusionauth_user_id } => {
            handle_delete_all_user_links(&ctx, &fusionauth_user_id).await?;
        }
    }

    cleanup_message(&ctx.sqs_worker, message).await?;
    Ok(())
}

/// Fetches a link by ID, cleaning up the message and returning `None` if not found.
async fn get_link_or_skip(
    ctx: &LinkManagerContext,
    message: &aws_sdk_sqs::types::Message,
    link_id: uuid::Uuid,
) -> anyhow::Result<Option<Link>> {
    let link = email_db_client::links::get::fetch_link_by_id(&ctx.db, link_id).await?;
    if link.is_none() {
        tracing::debug!(link_id=%link_id, "Link not found - skipping");
        cleanup_message(&ctx.sqs_worker, message).await?;
    }
    Ok(link)
}

/// Best-effort token fetch for stopping a Gmail watch during link teardown. A transient
/// auth-service failure would otherwise drop the stop silently and leave the watch
/// running, so retry a few times. A revoked grant (Forbidden) can never yield a token,
/// so don't retry it — the watch then lingers until Gmail expires it or the next connect
/// stops it.
async fn fetch_teardown_token(ctx: &LinkManagerContext, link: &Link) -> Option<String> {
    const MAX_ATTEMPTS: u32 = 3;

    for attempt in 1..=MAX_ATTEMPTS {
        match fetch_gmail_access_token_from_link(link, &ctx.redis_client, &ctx.auth_service_client)
            .await
        {
            Ok(token) => return Some(token),
            Err(e) if is_forbidden_error(&e) => {
                tracing::warn!(error=?e, link_id=%link.id, "Gmail access revoked; cannot stop watch (it will expire on its own)");
                return None;
            }
            Err(e) if attempt < MAX_ATTEMPTS => {
                tracing::warn!(error=?e, attempt, link_id=%link.id, "Transient failure fetching token to stop Gmail watch; retrying");
                tokio::time::sleep(std::time::Duration::from_millis(200 * u64::from(attempt)))
                    .await;
            }
            Err(e) => {
                tracing::warn!(error=?e, link_id=%link.id, "Could not fetch token to stop Gmail watch after retries; watch will linger until it expires or the next connect stops it");
                return None;
            }
        }
    }

    None
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

/// Notifies the inbox owner and every delegate that the link's grant has died and
/// the inbox must be reconnected. Reuses the new-mail recipient computation so a
/// shared inbox reaches everyone who could hold the Google grant.
#[tracing::instrument(skip(ctx), fields(link = ?link), err)]
async fn handle_notify_reauth_required(
    ctx: &LinkManagerContext,
    link: &Link,
) -> anyhow::Result<()> {
    let primaries = macro_db_client::macro_user_links::get_primaries_for_link(
        &ctx.db,
        link.macro_id.as_ref(),
        link.id,
    )
    .await
    .context("Failed to fetch delegated primaries for reauth notification")?;

    let recipient_ids = build_notification_recipients(&link.macro_id, primaries);

    let request = SendNotificationRequestBuilder {
        notification_entity: EntityType::User.with_entity_string(link.macro_id.to_string()),
        notification: InboxReauthRequiredMetadata {
            email_address: link.email_address.0.as_ref().to_string(),
        },
        sender_id: None,
        recipient_ids,
    }
    .into_request()
    .with_conn_gateway();

    ctx.notification_ingress_service
        .send_notification(request)
        .await
        .map_err(|e| anyhow!("failed to send reauth notification: {e}"))?;

    Ok(())
}

/// Fetches all links for a user and deletes each one via the existing delete handler.
#[tracing::instrument(skip(ctx), err)]
async fn handle_delete_all_user_links(
    ctx: &LinkManagerContext,
    fusionauth_user_id: &str,
) -> anyhow::Result<()> {
    let links =
        email_db_client::links::get::fetch_links_by_fusionauth_user_id(&ctx.db, fusionauth_user_id)
            .await
            .context("Failed to fetch links by fusionauth_user_id")?;

    if links.is_empty() {
        tracing::info!(fusionauth_user_id, "No email links found for user");
        return Ok(());
    }

    tracing::info!(
        fusionauth_user_id,
        link_count = links.len(),
        "Deleting all email links for user"
    );

    for link in &links {
        let gmail_access_token = fetch_teardown_token(ctx, link).await;

        if let Err(e) = handle_delete(
            ctx,
            link,
            gmail_access_token.as_deref(),
            &DeletionReason::UserDeleted,
        )
        .await
        {
            tracing::error!(error=?e, link_id=?link.id, "Failed to delete link during user cleanup");
        }
    }

    Ok(())
}

/// notifies downstream dependencies of link deletion, and deletes link (and all data) from database
#[tracing::instrument(skip(ctx, gmail_access_token), fields(link = ?link), err)]
async fn handle_delete(
    ctx: &LinkManagerContext,
    link: &Link,
    gmail_access_token: Option<&str>,
    deletion_reason: &DeletionReason,
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
        .delete_gmail_access_token(&TokenCacheKey::new(
            link.fusionauth_user_id.clone(),
            link.email_address.0.as_ref(),
            UserProvider::Gmail.as_str(),
        ))
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

    // remove google fusionauth link with gmail inbox permissions. must succeed before we delete
    // the email_links row below, otherwise a failure leaves a stale FA IdP link with no macrodb
    // counterpart (and the message is retried instead).
    ctx.auth_service_client
        .remove_link(
            &link.fusionauth_user_id,
            link.email_address.0.as_ref(),
            "google_gmail",
        )
        .await
        .context("Failed to remove FusionAuth IdP link")?;

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

    // Tear down CRM rows this link contributed to the user's team before
    // the big cascading link delete fires. Best-effort: a failure here
    // would only leave orphan `crm_contacts`/`crm_companies` rows behind
    // (the `crm_contact_sources` FK to `email_links` cascades on the
    // upcoming `delete_link_by_id`, so the link-scoped source rows go
    // away regardless), so we log and continue rather than bailing.
    let macro_id_str = link.macro_id.to_string();
    match ctx.crm_service.get_team_id_for_user(&macro_id_str).await {
        Ok(Some(team_id)) => {
            if let Err(e) = ctx
                .crm_service
                .depopulate_link_in_team(&team_id, &link.id)
                .await
            {
                tracing::error!(error=?e, team_id=%team_id, link_id=%link.id, "Failed to depopulate CRM rows before link delete; orphan crm_contacts/crm_companies may remain");
            }
        }
        Ok(None) => {
            tracing::debug!("User has no team; skipping CRM teardown before link delete");
        }
        Err(e) => {
            tracing::error!(error=?e, link_id=%link.id, "Failed to look up team for CRM teardown before link delete");
        }
    }

    // finally, delete all the user's link as well as all of their email data in a big cascading delete
    email_db_client::links::delete::delete_link_by_id(&ctx.db, link.id)
        .await
        .context("Failed to delete link in background task")?;

    // The teardown is async relative to the delete request, so signal completion
    // now that the rows are gone — a client showing this inbox can drop its data.
    cg_refresh_email(
        &ctx.connection_gateway_client,
        link.macro_id.as_ref(),
        RefreshEmailEvent::LinkRemoved { link_id: link.id },
    )
    .await;

    // Mark the link as deleted in history table for tracking (best-effort)
    if let Err(e) = email_db_client::links_history::update::set_deleted_at(
        &ctx.db,
        link.id,
        deletion_reason.as_str(),
    )
    .await
    {
        tracing::error!(error=?e, link_id=?link.id, "Failed to set deleted_at on email link history");
    }

    // Delegation edges scoped to the deleted link were cascaded away by FK; no
    // manual pruning is needed.

    // If the deleted link was a promoted shared mailbox, remove its minted macro user too
    // (this also cascades its delegation edges and the promoted-mailbox marker). No-op for
    // ordinary inboxes; best-effort, since the link and its data are already gone.
    match ctx.db.acquire().await {
        Ok(mut conn) => {
            match macro_db_client::shared_inbox::delete_promoted_mailbox_user(
                &mut conn,
                link.macro_id.as_ref(),
            )
            .await
            {
                Ok(Some(minted_id)) => {
                    // The minted id is the authoritative stub id: grant relocation creates the
                    // mailbox's FusionAuth user with it, so it can never be a human connector's
                    // account. Deleting by it (rather than the link's fusionauth_user_id, which
                    // is stale when the post-relocation re-home failed) cleans the stub even in
                    // partial states; the endpoint no-ops when relocation never created the user
                    // and refuses active users as a second guard.
                    let minted_id = minted_id.to_string();
                    if link.fusionauth_user_id != minted_id {
                        tracing::warn!(
                            link_fusionauth_user_id = %link.fusionauth_user_id,
                            %minted_id,
                            "Promoted mailbox link did not point at its minted stub; deleting stub by minted id"
                        );
                    }
                    if let Err(e) = ctx
                        .auth_service_client
                        .delete_inbox_grant_user(&minted_id)
                        .await
                    {
                        tracing::error!(error=?e, "Failed to delete FusionAuth stub for promoted shared mailbox");
                    }
                }
                Ok(None) => {}
                Err(e) => {
                    tracing::error!(error=?e, "Failed to delete minted user for promoted shared mailbox");
                }
            }
        }
        Err(e) => {
            tracing::error!(error=?e, "Failed to acquire connection for promoted mailbox cleanup");
        }
    }

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
