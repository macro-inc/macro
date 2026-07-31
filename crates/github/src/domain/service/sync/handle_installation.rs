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
