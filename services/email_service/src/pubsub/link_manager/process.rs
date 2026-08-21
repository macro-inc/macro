use crate::pubsub::link_manager::context::LinkManagerContext;
use crate::pubsub::util::{build_notification_recipients, cg_refresh_email, publish_email_event};
use crate::util::sync_contacts::sync_contacts;
use anyhow::{Context, anyhow};
use crm::domain::service::CrmService;
use email::domain::events::{
    EmailMacroEvent, LinkDisconnectReason, LinkDisconnectedMetadata, LinkReauthRequiredMetadata,
};
use email_api_client::domain::models::{AccessToken, EmailApiError, TokenFreshness};
use model_entity::EntityType;
use model_notifications::InboxReauthRequiredMetadata;
use models_email::api::refresh::RefreshEmailEvent;
use models_email::email::service::pubsub::{DeletionReason, LinkManagerMessage};
use models_email::service::cache::TokenCacheKey;
use models_email::service::link::{Link, UserProvider};
use notification::domain::models::SendNotificationRequestBuilder;
use notification::domain::service::NotificationIngress;
use sqs_worker::cleanup_message;
use std::future::Future;
use std::time::Duration;

#[cfg(test)]
mod test;

/// Backoff schedule for teardown provider calls: three attempts total.
const TEARDOWN_RETRY_DELAYS: [Duration; 2] =
    [Duration::from_millis(200), Duration::from_millis(400)];

/// Runs a teardown provider call with a bounded retry (3 attempts, 200/400ms).
///
/// Only transient failures retry. Permanent errors (revoked grants, missing
/// scopes) return immediately: retrying cannot help while tearing a link down.
async fn retry_teardown<F, Fut>(mut operation: F) -> Result<(), EmailApiError>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<(), EmailApiError>>,
{
    let mut delays = TEARDOWN_RETRY_DELAYS.iter();
    loop {
        match operation().await {
            Ok(()) => return Ok(()),
            Err(error) if error.is_transient() => match delays.next() {
                Some(delay) => tokio::time::sleep(*delay).await,
                None => return Err(error),
            },
            Err(error) => return Err(error),
        }
    }
}

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

            let result = ctx
                .email_api
                .get_access_token(link.id, TokenFreshness::Cached)
                .await;

            if settle_reauth_fetch(&ctx, &link, result).await?.is_some() {
                handle_refresh(&ctx, &link).await?;
            }
        }
        LinkManagerMessage::HealthCheck { link_id } => {
            let link = get_link_or_skip(&ctx, message, link_id).await?;
            let Some(link) = link else { return Ok(()) };

            // Probe-only: the health side effects happen inside the fetch; a live token
            // needs no follow-up work here. No-cache so a just-revoked grant is observed
            // now rather than masked by a still-valid cached access token.
            let result = ctx
                .email_api
                .get_access_token(link.id, TokenFreshness::Fresh)
                .await;

            settle_reauth_fetch(&ctx, &link, result).await?;
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

            handle_delete(&ctx, &link, &deletion_reason).await?;
        }
        LinkManagerMessage::DeleteUser { fusionauth_user_id } => {
            handle_delete_all_user_links(&ctx, &fusionauth_user_id).await?;
        }
    }

    cleanup_message(&ctx.sqs_worker, message).await?;
    Ok(())
}

/// Settles the outcome of a service token probe that records reauth health.
/// Returns the token on success. When the grant is gone the link has already been
/// marked for reauth as a side effect, so the message is terminal — return `None` to let it
/// be dropped — but only once that mark is persisted; if the mark write itself failed,
/// propagate the error so the message retries and the health signal isn't lost. Other,
/// transient errors propagate to retry.
async fn settle_reauth_fetch(
    ctx: &LinkManagerContext,
    link: &Link,
    result: Result<AccessToken, EmailApiError>,
) -> anyhow::Result<Option<AccessToken>> {
    match result {
        Ok(token) => Ok(Some(token)),
        Err(EmailApiError::AuthRequired) => {
            let persisted = email_db_client::links::get::fetch_link_by_id(&ctx.db, link.id)
                .await
                .context("Failed to verify needs_reauth state after token fetch failure")?
                .is_some_and(|l| l.needs_reauth);

            settle_reauth_result(Err(EmailApiError::AuthRequired), persisted)
        }
        result => settle_reauth_result(result, false),
    }
}

fn settle_reauth_result(
    result: Result<AccessToken, EmailApiError>,
    needs_reauth_persisted: bool,
) -> anyhow::Result<Option<AccessToken>> {
    match result {
        Ok(token) => Ok(Some(token)),
        Err(EmailApiError::AuthRequired) if needs_reauth_persisted => Ok(None),
        Err(error) => Err(anyhow::Error::new(error)),
    }
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

/// Handles the Refresh operation: renews Gmail watch subscription and syncs contacts.
#[tracing::instrument(skip(ctx), fields(link = ?link), err)]
async fn handle_refresh(ctx: &LinkManagerContext, link: &Link) -> anyhow::Result<()> {
    // A refused or transient renewal must leave the worker message available for retry.
    // Deterministic provider failures preserve the previous best-effort behavior.
    if let Err(error) = ctx.email_api.register_subscription(link.id).await {
        if matches!(error, EmailApiError::AuthRequired) {
            settle_reauth_fetch(ctx, link, Err(error)).await?;
            return Ok(());
        }
        if error.is_transient() {
            return Err(anyhow::Error::new(error).context("Failed to renew Gmail watch"));
        }
        tracing::error!(error=?error, "Failed to renew Gmail watch");
    }

    // Sync contacts and update sync tokens in the database
    if let Err(e) = sync_contacts(
        link,
        &ctx.db,
        &ctx.email_api,
        &ctx.sqs_client,
        &ctx.macro_event_broker,
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
        secondary_notification_entity: None,
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

    // This message is enqueued only on the false->true needs_reauth
    // transition, so the event stays edge-triggered.
    publish_email_event(
        &ctx.macro_event_broker,
        &EmailMacroEvent::link_reauth_required(LinkReauthRequiredMetadata {
            link_id: link.id,
            owner: link.macro_id.clone(),
            email_address: link.email_address.0.as_ref().to_string(),
            observed_at: link.last_sync_error_at.unwrap_or_else(chrono::Utc::now),
        }),
    );

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
        if let Err(e) = handle_delete(ctx, link, &DeletionReason::UserDeleted).await {
            tracing::error!(error=?e, link_id=?link.id, "Failed to delete link during user cleanup");
        }
    }

    Ok(())
}

/// notifies downstream dependencies of link deletion, and deletes link (and all data) from database
#[tracing::instrument(skip(ctx), fields(link = ?link), err)]
async fn handle_delete(
    ctx: &LinkManagerContext,
    link: &Link,
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

    // Best effort: revoked grants and provider failures must not block local teardown.
    // Stop before evicting the token so a valid cached grant remains available for the call.
    // The health-neutral path never marks the link as needing reauth or notifies the
    // user about an inbox that is being intentionally removed.
    retry_teardown(|| ctx.email_api.stop_subscription_for_link(link))
        .await
        .inspect_err(|error| {
            tracing::warn!(error=?error, "Gmail call to stop watch failed");
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

    // remove google fusionauth link with gmail inbox permissions. best-effort: the FA user may
    // already be gone (e.g. account deleted before we delete their email), so we warn and keep
    // going rather than failing the message and retrying.
    ctx.auth_service_client
        .remove_link(
            &link.fusionauth_user_id,
            link.email_address.0.as_ref(),
            "google_gmail",
        )
        .await
        .inspect_err(|e| {
            tracing::warn!(error=?e, "Failed to remove FusionAuth IdP link");
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

    publish_email_event(
        &ctx.macro_event_broker,
        &EmailMacroEvent::link_disconnected(LinkDisconnectedMetadata {
            link_id: link.id,
            owner: link.macro_id.clone(),
            email_address: link.email_address.0.as_ref().to_string(),
            reason: match deletion_reason {
                DeletionReason::Unused => LinkDisconnectReason::Unused,
                DeletionReason::Inactive => LinkDisconnectReason::Inactive,
                DeletionReason::ManuallyDisabled => LinkDisconnectReason::ManuallyDisabled,
                DeletionReason::UserDeleted => LinkDisconnectReason::UserDeleted,
                DeletionReason::AccessRevoked => LinkDisconnectReason::AccessRevoked,
            },
        }),
    );

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
