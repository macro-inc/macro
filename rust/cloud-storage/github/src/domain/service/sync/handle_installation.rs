//! Installation event handlers.

use crate::domain::{
    models::{GithubError, ValidatedGithubWebhookEvent},
    ports::{GithubSyncClient, GithubSyncRepo},
};
use documents::domain::ports::DocumentService;

use super::GithubSyncServiceImpl;

impl<D: DocumentService, R: GithubSyncRepo, C: GithubSyncClient> GithubSyncServiceImpl<D, R, C> {
    /// Handle `installation` events with action `created`.
    ///
    /// Associates the GitHub App installation with all teams the installer belongs to.
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
                    "no github link found for sender, cannot associate installation with teams"
                );
                return Ok(());
            }
        };

        let team_ids = self
            .repo
            .get_user_team_ids(&macro_id)
            .await
            .map_err(|e| GithubError::Internal(e.into()))?;

        if team_ids.is_empty() {
            tracing::info!(
                installation_id,
                "user has no teams, skipping installation association"
            );
            return Ok(());
        }

        tracing::info!(
            installation_id,
            team_count = team_ids.len(),
            "associating installation with user teams"
        );

        self.repo
            .insert_installation_team_associations(&installation_id_str, &team_ids, &macro_id)
            .await
            .map_err(|e| GithubError::Internal(e.into()))?;

        Ok(())
    }
}
