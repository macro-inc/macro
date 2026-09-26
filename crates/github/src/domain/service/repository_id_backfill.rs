//! Giving pull request records synced before repository ids were stored the id of their
//! repository.
//!
//! Pull request filters and facets identify a repository by GitHub's numeric id, which survives
//! renames and transfers. Older records carry only the owner and name they were synced under, so
//! this pages through every installation, asks GitHub which repositories it covers, and gives
//! each record the id of the repository whose name it carries. Only missing ids are filled, so a
//! page can be re-run safely.

use foreign_entity::domain::{
    models::GithubRepositoryIdentity, ports::GithubRepositoryIdBackfillService,
};

use crate::domain::models::{
    AppJwt, GithubError, RepositoryIdBackfillPage, RepositoryIdBackfillRequest, app_jwt,
};
use crate::domain::ports::{
    GithubInstallationLister, GithubRepositoryClient, GithubRepositoryIdBackfill,
};

use super::InstallationTokenConfig;

#[cfg(test)]
mod test;

/// Installations processed per call when the request does not say.
const DEFAULT_PAGE_SIZE: u32 = 25;
/// The most installations one call processes, keeping a call well inside request timeouts.
const MAX_PAGE_SIZE: u32 = 100;

/// Backfills repository ids one page of installations at a time.
pub struct RepositoryIdBackfillService<Installations, Client, PullRequests> {
    config: InstallationTokenConfig,
    installations: Installations,
    client: Client,
    pull_requests: PullRequests,
}

impl<Installations, Client, PullRequests>
    RepositoryIdBackfillService<Installations, Client, PullRequests>
{
    /// Build the service over the App's credentials, the recorded installations, a GitHub
    /// client, and the pull request records to update.
    pub fn new(
        config: InstallationTokenConfig,
        installations: Installations,
        client: Client,
        pull_requests: PullRequests,
    ) -> Self {
        Self {
            config,
            installations,
            client,
            pull_requests,
        }
    }
}

impl<Installations, Client, PullRequests> GithubRepositoryIdBackfill
    for RepositoryIdBackfillService<Installations, Client, PullRequests>
where
    Installations: GithubInstallationLister,
    Client: GithubRepositoryClient,
    PullRequests: GithubRepositoryIdBackfillService,
{
    #[tracing::instrument(skip(self), err)]
    async fn backfill_repository_ids(
        &self,
        request: RepositoryIdBackfillRequest,
    ) -> Result<RepositoryIdBackfillPage, GithubError> {
        let limit = request
            .limit
            .unwrap_or(DEFAULT_PAGE_SIZE)
            .clamp(1, MAX_PAGE_SIZE);
        let installation_ids = self
            .installations
            .list_installation_ids(request.after.as_deref(), limit)
            .await
            .map_err(|error| {
                GithubError::Internal(anyhow::anyhow!("could not list installations: {error:?}"))
            })?;

        // A full page may have more after it; a short one is the last.
        let next_after = if installation_ids.len() == limit as usize {
            installation_ids.last().cloned()
        } else {
            None
        };
        let mut page = RepositoryIdBackfillPage {
            installations: 0,
            repositories: 0,
            updated_pull_requests: 0,
            failed_installation_ids: Vec::new(),
            next_after,
        };
        if installation_ids.is_empty() {
            return Ok(page);
        }

        let jwt = app_jwt(&self.config.client_id, &self.config.private_key_pem)?;
        for installation_id in installation_ids {
            page.installations += 1;
            let Some(repositories) = self.list_repositories(&jwt, &installation_id).await else {
                page.failed_installation_ids.push(installation_id);
                continue;
            };
            page.repositories += u32::try_from(repositories.len()).unwrap_or(u32::MAX);
            page.updated_pull_requests += self
                .pull_requests
                .set_missing_github_repository_ids(&repositories)
                .await
                .map_err(|error| {
                    GithubError::Internal(anyhow::anyhow!(
                        "could not store repository ids for installation {installation_id}: {error}"
                    ))
                })?;
        }

        Ok(page)
    }
}

impl<Installations, Client, PullRequests>
    RepositoryIdBackfillService<Installations, Client, PullRequests>
where
    Client: GithubRepositoryClient,
{
    /// The installation's repositories, or `None` when GitHub will not list them, for example
    /// because the installation was suspended or removed.
    async fn list_repositories(
        &self,
        jwt: &AppJwt,
        installation_id: &str,
    ) -> Option<Vec<GithubRepositoryIdentity>> {
        let installation = installation_id
            .parse::<u64>()
            .inspect_err(|error| {
                tracing::warn!(error=?error, installation_id, "installation id is not a number");
            })
            .ok()?;
        let repositories = self
            .client
            .repositories_for_installation(jwt, installation)
            .await
            .inspect_err(|error| {
                tracing::warn!(error=?error, installation_id, "could not list installation repositories");
            })
            .ok()?;

        Some(
            repositories
                .into_iter()
                .map(|repository| GithubRepositoryIdentity {
                    id: repository.id,
                    owner: repository.owner,
                    name: repository.name,
                })
                .collect(),
        )
    }
}
