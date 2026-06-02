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
    /// Associates the GitHub App installation with the installer's team or user source.
    #[tracing::instrument(skip(self, event), err)]
    pub(crate) async fn handle_installation_created(
        &self,
        event: &ValidatedGithubWebhookEvent,
    ) -> Result<(), GithubError> {
        let installation_id = event
            .installation_id()
            .ok_or_else(|| GithubError::Internal(anyhow::anyhow!("missing installation.id")))?;
        let installation_id_str = installation_id.to_string();

        let sender_github_user_id = event.sender_github_user_id().ok_or_else(|| {
            GithubError::Internal(anyhow::anyhow!("missing sender.id in installation event"))
        })?;

        tracing::info!(installation_id, "processing installation created event");

        let macro_id = self
            .repo
            .get_macro_id_by_github_user_id(&sender_github_user_id)
            .await
            .map_err(|e| GithubError::Internal(e.into()))?;

        let macro_id = match macro_id {
            Some(id) => id,
            None => {
                tracing::warn!(
                    installation_id,
                    "no github link found for sender, cannot associate installation with a source"
                );
                return Ok(());
            }
        };

        let team_ids = self
            .repo
            .get_user_team_ids(&macro_id)
            .await
            .map_err(|e| GithubError::Internal(e.into()))?;

        let sources = if team_ids.is_empty() {
            tracing::info!(
                installation_id,
                "user has no teams, associating installation with user source"
            );
            vec![GithubAppInstallationSource::User(macro_id)]
        } else {
            tracing::info!(
                installation_id,
                team_count = team_ids.len(),
                "associating installation with user teams"
            );
            team_ids
                .into_iter()
                .map(GithubAppInstallationSource::Team)
                .collect()
        };

        self.repo
            .upsert_installation_sources(&installation_id_str, &sources)
            .await
            .map_err(|e| GithubError::Internal(e.into()))?;

        self.backfill_open_pull_request_foreign_entities(installation_id, &sources)
            .await?;

        Ok(())
    }
}
