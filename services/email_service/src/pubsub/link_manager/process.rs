use crate::pubsub::link_manager::context::LinkManagerContext;
use crate::pubsub::util::{build_notification_recipients, cg_refresh_email, publish_email_event};
use anyhow::{Context, anyhow};
use crm::domain::service::CrmService;
use email::domain::events::{
    EmailMacroEvent, LinkDisconnectReason, LinkDisconnectedMetadata, LinkReauthRequiredMetadata,
};
#[cfg(test)]
use email_api_client::domain::models::AccessToken;
#[cfg(test)]
use email_api_client::domain::models::EmailApiError;
use model_entity::EntityType;
use model_notifications::InboxReauthRequiredMetadata;
use models_email::api::refresh::RefreshEmailEvent;
use models_email::email::service::pubsub::{DeletionReason, LinkManagerMessage};
use models_email::service::link::Link;
use notification::domain::models::SendNotificationRequestBuilder;
use notification::domain::service::NotificationIngress;
use sqs_worker::cleanup_message;

#[cfg(test)]
mod test;

#[cfg(test)]
use crate::outbound::inbox_lifecycle::retry_teardown;

#[tracing::instrument(skip(ctx, message), err)]
pub async fn process_message(
    ctx: LinkManagerContext,
    message: &aws_sdk_sqs::types::Message,
) -> anyhow::Result<()> {
    let notification_data = extract_message(message)?;

    match notification_data {
        LinkManagerMessage::Refresh { link_id } => ctx.inbox_health.probe(link_id, true).await?,
        LinkManagerMessage::HealthCheck { link_id } => {
            ctx.inbox_health.probe(link_id, false).await?
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

            if ctx
                .inbox_lifecycle
                .prepare_delete(link_id, deletion_reason)
                .await?
            {
                handle_delete(&ctx, &link, &deletion_reason).await?;
            }
        }
        LinkManagerMessage::DeleteUser { fusionauth_user_id } => {
            ctx.inbox_lifecycle
                .deleted_user(&fusionauth_user_id)
                .await?;
        }
    }

    cleanup_message(&ctx.sqs_worker, message).await?;
    Ok(())
}

#[cfg(test)]
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

    crate::outbound::inbox_lifecycle::remove_provider_link(
        &ctx.email_api,
        &ctx.auth_service_client,
        &ctx.redis_client,
        link,
    )
    .await;

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
