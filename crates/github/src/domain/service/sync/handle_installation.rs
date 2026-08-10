//! Installation event handlers.

use crate::domain::{
    models::{GithubAppInstallationSource, GithubError, ValidatedGithubWebhookEvent},
    ports::{GithubSyncClient, GithubSyncRepo},
};
use documents::domain::ports::DocumentService;
use foreign_entity::domain::ports::ForeignEntityService;
use notification::domain::service::NotificationIngress;

use super::GithubSyncServiceImpl;

impl<
    D: DocumentService,
    R: GithubSyncRepo,
    C: GithubSyncClient,
    F: ForeignEntityService,
    N: NotificationIngress,
> GithubSyncServiceImpl<D, R, C, F, N>
{
    /// Handle `installation` events with action `created`.
    ///
    /// Completes the org-approval install flow: when an admin approves another
    /// user's installation request, the payload's `requester` identifies who
    /// asked, and their pending installation request (recorded by the
    /// authenticated setup callback) carries the Macro source to associate.
    /// Installations created directly through the authenticated setup flow
    /// have no `requester` and are associated by the setup callback instead.
    #[tracing::instrument(skip(self, event), err)]
    pub(crate) async fn handle_installation_created(
        &self,
        event: &ValidatedGithubWebhookEvent,
    ) -> Result<(), GithubError> {
        let installation_id = event
            .installation_id()
            .ok_or_else(|| GithubError::Internal(anyhow::anyhow!("missing installation.id")))?;

        let Some(requester_github_user_id) = event.requester_github_user_id() else {
            tracing::info!(
                installation_id,
                "installation created without a requester; direct installs are associated by the authenticated setup flow"
            );
            return Ok(());
        };

        let Some(source) = self
            .repo
            .get_installation_request(&requester_github_user_id)
            .await
            .map_err(|e| GithubError::Internal(e.into()))?
        else {
            tracing::warn!(
                installation_id,
                requester_github_user_id,
                "no pending installation request found for approved installation"
            );
            return Ok(());
        };

        self.associate_installation_with_sources(installation_id, &[source])
            .await?;

        // Deleted only after association succeeds so a webhook redelivery can
        // retry; a redelivery after deletion finds no pending request and is a
        // no-op.
        self.repo
            .delete_installation_request(&requester_github_user_id)
            .await
            .map_err(|e| GithubError::Internal(e.into()))?;

        Ok(())
    }

    /// Handle `installation` events with action `deleted`.
    ///
    /// Removes the installation's source associations. Idempotent: GitHub retries
    /// webhooks, so deleting an already-removed installation succeeds.
    #[tracing::instrument(skip(self, event), err)]
    pub(crate) async fn handle_installation_deleted(
        &self,
        event: &ValidatedGithubWebhookEvent,
    ) -> Result<(), GithubError> {
        let installation_id = event
            .installation_id()
            .ok_or_else(|| GithubError::Internal(anyhow::anyhow!("missing installation.id")))?
            .to_string();

        tracing::info!(installation_id, "processing installation deleted event");

        self.repo
            .delete_installation_sources(&installation_id)
            .await
            .map_err(|e| GithubError::Internal(e.into()))?;

        Ok(())
    }

    /// Persist the installation-to-source associations and backfill open pull
    /// requests visible to the installation.
    pub(crate) async fn associate_installation_with_sources(
        &self,
        installation_id: u64,
        sources: &[GithubAppInstallationSource],
    ) -> Result<(), GithubError> {
        self.repo
            .upsert_installation_sources(&installation_id.to_string(), sources)
            .await
            .map_err(|e| GithubError::Internal(e.into()))?;

        self.backfill_open_pull_request_foreign_entities(installation_id, sources)
            .await?;

        Ok(())
    }
}
