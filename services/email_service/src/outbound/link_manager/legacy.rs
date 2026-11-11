//! Temporary physical-deletion bridge, kept verbatim until the purge extraction.

use crate::outbound::email_api::GmailApi;
use crate::pubsub::context::{CrmServiceType, PubSubEventBroker};
use crate::pubsub::util::{cg_refresh_email, publish_email_event};
use crate::util::redis::RedisClient;
use anyhow::Context;
use authentication_service_client::AuthServiceClient;
use connection_gateway_client::client::ConnectionGatewayClient;
use crm::domain::service::CrmService;
use email::domain::events::{EmailMacroEvent, LinkDisconnectReason, LinkDisconnectedMetadata};
use email::domain::mailbox::link_manager::LegacyLinkDeletion;
use email_db_client::links::delete::PurgePacing;
use models_email::api::refresh::RefreshEmailEvent;
use models_email::service::link::Link;
use models_email::service::pubsub::DeletionReason;
use sqlx::PgPool;

pub(crate) struct LegacyLinkDeletionAdapter {
    pub db: PgPool,
    pub email_api: GmailApi,
    pub auth_service_client: AuthServiceClient,
    pub redis_client: RedisClient,
    pub crm_service: CrmServiceType,
    pub connection_gateway_client: ConnectionGatewayClient,
    pub macro_event_broker: PubSubEventBroker,
}

impl LegacyLinkDeletion for LegacyLinkDeletionAdapter {
    async fn delete(&self, link: &Link, reason: &DeletionReason) -> anyhow::Result<()> {
        handle_delete(self, link, reason).await
    }
}

/// notifies downstream dependencies of link deletion, and deletes link (and all data) from database
#[tracing::instrument(skip(ctx), fields(link = ?link), err)]
async fn handle_delete(
    ctx: &LegacyLinkDeletionAdapter,
    link: &Link,
    deletion_reason: &DeletionReason,
) -> anyhow::Result<()> {
    tracing::info!("Deleting link");
    // mark the link as being deleted, which stops sync so any future inbox updates get ignored
    email_db_client::links::delete::mark_link_deleting(&ctx.db, link.id)
        .await
        .context("Failed to mark link as deleting")?;

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
    // the link is purged. Best-effort: a failure here
    // would only leave orphan `crm_contacts`/`crm_companies` rows behind
    // (the `crm_contact_sources` FK to `email_links` cascades when the
    // upcoming `purge_link` deletes the link row, so the link-scoped source rows go
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

    // finally, delete the link and all of its email data in bounded batches; a redelivered
    // message resumes the purge where an interrupted one stopped
    email_db_client::links::delete::purge_link(&ctx.db, link.id, PurgePacing::default())
        .await
        .context("Failed to purge link in background task")?;

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
