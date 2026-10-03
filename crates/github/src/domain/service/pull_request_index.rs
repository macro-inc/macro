//! Writing typed rows for pull requests stored before rows existed.
//!
//! A pull request row is identified by its repository's numeric id, which older records do not
//! carry. This pages through every installation, asks GitHub which repositories it covers, and
//! has the pull request store write a row for each record synced under one of those
//! repositories' names. Rows are rewritten from the record each time, so a page can be re-run
//! safely.

use github_pull_requests::domain::{
    models::GithubRepositoryIdentity, ports::GithubPullRequestIndexer,
};

use crate::domain::models::{
    AppJwt, GithubError, PullRequestIndexPage, PullRequestIndexRequest, app_jwt,
};
use crate::domain::ports::{
    GithubInstallationLister, GithubPullRequestIndex, GithubRepositoryClient,
};

use super::InstallationTokenConfig;

#[cfg(test)]
mod test;

/// Installations processed per call when the request does not say.
const DEFAULT_PAGE_SIZE: u32 = 25;
/// The most installations one call processes, keeping a call well inside request timeouts.
const MAX_PAGE_SIZE: u32 = 100;

/// Indexes stored pull requests one page of installations at a time.
pub struct PullRequestIndexService<Installations, Client, PullRequests> {
    config: InstallationTokenConfig,
    installations: Installations,
    client: Client,
    pull_requests: PullRequests,
}

impl<Installations, Client, PullRequests>
    PullRequestIndexService<Installations, Client, PullRequests>
{
    /// Build the service over the App's credentials, the recorded installations, a GitHub
    /// client, and the pull request store.
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

impl<Installations, Client, PullRequests> GithubPullRequestIndex
    for PullRequestIndexService<Installations, Client, PullRequests>
where
    Installations: GithubInstallationLister,
    Client: GithubRepositoryClient,
    PullRequests: GithubPullRequestIndexer,
{
    #[tracing::instrument(skip(self), err)]
    async fn index_pull_requests(
        &self,
        request: PullRequestIndexRequest,
    ) -> Result<PullRequestIndexPage, GithubError> {
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
        let mut page = PullRequestIndexPage {
            installations: 0,
            repositories: 0,
            indexed_pull_requests: 0,
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
            page.indexed_pull_requests += self
                .pull_requests
                .index_repositories(&repositories)
                .await
                .map_err(|error| {
                    GithubError::Internal(anyhow::anyhow!(
                        "could not index pull requests for installation {installation_id}: {error}"
                    ))
                })?;
        }

        Ok(page)
    }
}

impl<Installations, Client, PullRequests>
    PullRequestIndexService<Installations, Client, PullRequests>
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
