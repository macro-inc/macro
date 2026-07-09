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

        let sender_github_user_id = event.sender_github_user_id().ok_or_else(|| {
            GithubError::Internal(anyhow::anyhow!("missing sender.id in installation event"))
        })?;

        tracing::info!(installation_id, "processing installation created event");

        // Always record the installer, even when no link exists yet: it lets a
        // later github_links creation associate this installation retroactively.
        self.repo
            .upsert_installation_installer(&installation_id.to_string(), &sender_github_user_id)
            .await
            .map_err(|e| GithubError::Internal(e.into()))?;

        let sources = self.sources_for_github_user(&sender_github_user_id).await?;
        if sources.is_empty() {
            tracing::warn!(
                installation_id,
                "no github link found for sender, cannot associate installation with a source"
            );
            return Ok(());
        }

        self.associate_installation_with_sources(installation_id, &sources)
            .await
    }

    /// Compute the Macro sources (teams or users) for every Macro user linked
    /// to the given GitHub user. Returns an empty list when no link exists.
    pub(crate) async fn sources_for_github_user(
        &self,
        github_user_id: &str,
    ) -> Result<Vec<GithubAppInstallationSource>, GithubError> {
        let links = self
            .repo
            .get_macro_ids_by_github_user_ids(std::slice::from_ref(&github_user_id.to_string()))
            .await
            .map_err(|e| GithubError::Internal(e.into()))?;

        let macro_ids = links.get(github_user_id).cloned().unwrap_or_default();

        // A GitHub account may be linked to several Macro users; collect the
        // team/user source of every linked user.
        let mut seen = std::collections::HashSet::new();
        let mut sources = Vec::new();
        for macro_id in macro_ids {
            let team_ids = self
                .repo
                .get_user_team_ids(&macro_id)
                .await
                .map_err(|e| GithubError::Internal(e.into()))?;

            if team_ids.is_empty() {
                tracing::info!(
                    github_user_id,
                    "user has no teams, using user source for installation association"
                );
                let source = GithubAppInstallationSource::User(macro_id);
                if seen.insert(source.clone()) {
                    sources.push(source);
                }
            } else {
                tracing::info!(
                    github_user_id,
                    team_count = team_ids.len(),
                    "using team sources for installation association"
                );
                for team_id in team_ids {
                    let source = GithubAppInstallationSource::Team(team_id);
                    if seen.insert(source.clone()) {
                        sources.push(source);
                    }
                }
            }
        }

        Ok(sources)
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
