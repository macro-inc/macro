//! Physical link deletion: provider teardown, CRM cleanup, purge and completion effects.

mod ports;
mod provider;
#[cfg(test)]
mod test;

pub use ports::*;

use super::{LinkDeletion, purge::PurgePacing};
use crate::domain::events::{EmailMacroEvent, LinkDisconnectReason, LinkDisconnectedMetadata};
use anyhow::Context;
use macro_event_broker::MacroEventBroker;
use models_email::service::{link::Link, pubsub::DeletionReason};

/// Coordinates physical deletion after the lifecycle service permits it.
pub struct LinkDeletionService<R, G, A, C, P, N, B> {
    /// Existing history/job updates and connection acquisition.
    pub repository: R,
    /// Health-neutral Gmail watch and cache operations.
    pub gmail: G,
    /// Credential grant and promoted-stub operations.
    pub auth: A,
    /// Existing CRM domain service.
    pub crm: C,
    /// Existing incremental purge domain service.
    pub purge: P,
    /// Existing client refresh effect.
    pub refresh: N,
    /// Existing non-blocking event publisher.
    pub broker: B,
}

impl<R, G, A, C, P, N, B> LinkDeletion for LinkDeletionService<R, G, A, C, P, N, B>
where
    R: LinkDeletionRepository,
    G: LinkDeletionGmail,
    A: LinkDeletionAuth,
    C: LinkDeletionCrm,
    P: LinkPurger,
    N: LinkDeletionRefresh,
    B: MacroEventBroker,
{
    async fn delete(&self, link: &Link, reason: &DeletionReason) -> anyhow::Result<()> {
        self.handle_delete(link, reason).await
    }
}

impl<R, G, A, C, P, N, B> LinkDeletionService<R, G, A, C, P, N, B>
where
    R: LinkDeletionRepository,
    G: LinkDeletionGmail,
    A: LinkDeletionAuth,
    C: LinkDeletionCrm,
    P: LinkPurger,
    N: LinkDeletionRefresh,
    B: MacroEventBroker,
{
    /// notifies downstream dependencies of link deletion, and deletes link (and all data) from database
    #[tracing::instrument(skip(self), fields(link = ?link), err)]
    async fn handle_delete(
        &self,
        link: &Link,
        deletion_reason: &DeletionReason,
    ) -> anyhow::Result<()> {
        tracing::info!("Deleting link");
        // mark the link as being deleted, which stops sync so any future inbox updates get ignored
        self.repository
            .mark_link_deleting(link.id)
            .await
            .context("Failed to mark link as deleting")?;

        // cancel any running backfill jobs
        self.repository
            .cancel_active_jobs(link.id)
            .await
            .inspect_err(|e| {
                tracing::error!(error=?e, "Failed to update backfill job statuses");
            })
            .ok();

        provider::remove_provider_link(&self.gmail, &self.auth, link).await;

        // Tear down CRM rows this link contributed to the user's team before
        // the link is purged. Best-effort: a failure here
        // would only leave orphan `crm_contacts`/`crm_companies` rows behind
        // (the `crm_contact_sources` FK to `email_links` cascades when the
        // upcoming `purge_link` deletes the link row, so the link-scoped source rows go
        // away regardless), so we log and continue rather than bailing.
        let macro_id_str = link.macro_id.to_string();
        match self.crm.get_team_id_for_user(&macro_id_str).await {
            Ok(Some(team_id)) => {
                if let Err(e) = self.crm.depopulate_link_in_team(&team_id, &link.id).await {
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
        self.purge
            .purge_link(link.id, PurgePacing::default())
            .await
            .context("Failed to purge link in background task")?;

        // The teardown is async relative to the delete request, so signal completion
        // now that the rows are gone — a client showing this inbox can drop its data.
        self.refresh
            .link_removed(link.macro_id.as_ref(), link.id)
            .await;

        let _ = self
            .broker
            .send_event(&EmailMacroEvent::link_disconnected(
                LinkDisconnectedMetadata {
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
                },
            ))
            .inspect_err(|e| tracing::error!(error=?e, "failed to publish email macro event"));

        // Mark the link as deleted in history table for tracking (best-effort)
        if let Err(e) = self
            .repository
            .set_deleted_at(link.id, deletion_reason.as_str())
            .await
        {
            tracing::error!(error=?e, link_id=?link.id, "Failed to set deleted_at on email link history");
        }

        // Delegation edges scoped to the deleted link were cascaded away by FK; no
        // manual pruning is needed.

        // If the deleted link was a promoted shared mailbox, remove its minted macro user too
        // (this also cascades its delegation edges and the promoted-mailbox marker). No-op for
        // ordinary inboxes; best-effort, since the link and its data are already gone.
        match self.repository.acquire().await {
            Ok(mut conn) => {
                match conn
                    .delete_promoted_mailbox_user(link.macro_id.as_ref())
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
                        if let Err(e) = self.auth.delete_inbox_grant_user(&minted_id).await {
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
}
