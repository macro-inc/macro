//! Read a GitHub pull request's metadata and its diff with a repository-scoped App token.

use std::time::Duration;

use github_pull_requests::domain::models::{
    ChangesetRange, GitRef, GithubPullRequestDiff, GithubPullRequestDiffError, PullRequestRef,
};
use github_pull_requests::domain::ports::GithubPullRequestDiffReader;
use macro_user_id::user_id::MacroUserIdStr;
use reqwest::StatusCode;
use serde::Deserialize;

use crate::domain::models::GithubError;
use crate::domain::ports::{GithubSyncClient, GithubSyncRepo};
use crate::domain::service::InstallationTokenService;

#[cfg(test)]
mod test;

const GITHUB_API_BASE_URL: &str = "https://api.github.com";
const READ_PERMISSIONS: &[(&str, &str)] = &[("pull_requests", "read")];
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);

/// GitHub REST adapter for a pull request's diff.
pub struct GithubPullRequestDiffClient<Installations, Client> {
    tokens: InstallationTokenService<Installations, Client>,
    http: reqwest::Client,
    api_base_url: String,
}

impl<Installations: GithubSyncRepo, Client: GithubSyncClient>
    GithubPullRequestDiffClient<Installations, Client>
{
    /// Mint repository-scoped tokens through `tokens`.
    pub fn new(tokens: InstallationTokenService<Installations, Client>) -> Self {
        Self::with_api_base_url(tokens, GITHUB_API_BASE_URL.to_owned())
    }

    /// Use another API origin for adapter tests.
    pub fn with_api_base_url(
        tokens: InstallationTokenService<Installations, Client>,
        api_base_url: String,
    ) -> Self {
        Self {
            tokens,
            http: reqwest::Client::builder()
                .timeout(REQUEST_TIMEOUT)
                .build()
                .expect("GitHub HTTP client"),
            api_base_url,
        }
    }

    async fn get(
        &self,
        url: &str,
        token: &str,
        accept: &str,
    ) -> Result<String, GithubPullRequestDiffError> {
        let response = self
            .http
            .get(url)
            .bearer_auth(token)
            .header("Accept", accept)
            .header("User-Agent", "Macro-Agent-Changes")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .send()
            .await
            .map_err(|error| GithubPullRequestDiffError::Other(error.into()))?;
        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|error| GithubPullRequestDiffError::Other(error.into()))?;
        if !status.is_success() {
            return Err(status_error(status, &body));
        }
        Ok(body)
    }
}

#[derive(Deserialize)]
struct PullRequestMetadata {
    base: PullRequestBranch,
    head: PullRequestBranch,
}

#[derive(Deserialize)]
struct PullRequestBranch {
    #[serde(rename = "ref")]
    name: String,
    sha: String,
}

impl From<PullRequestBranch> for GitRef {
    fn from(branch: PullRequestBranch) -> Self {
        Self {
            name: Some(branch.name),
            sha: Some(branch.sha),
        }
    }
}

impl<Installations: GithubSyncRepo, Client: GithubSyncClient> GithubPullRequestDiffReader
    for GithubPullRequestDiffClient<Installations, Client>
{
    #[tracing::instrument(skip_all, err)]
    async fn read(
        &self,
        user: &MacroUserIdStr<'static>,
        pull_request: &PullRequestRef,
    ) -> Result<GithubPullRequestDiff, GithubPullRequestDiffError> {
        let repository = &pull_request.repository;
        let token = self
            .tokens
            .for_repository(user, &repository.owner, &repository.name, READ_PERMISSIONS)
            .await
            .map_err(|error| match error {
                GithubError::RepositoryUnavailable => GithubPullRequestDiffError::Unavailable,
                other => {
                    GithubPullRequestDiffError::Other(anyhow::anyhow!("github token: {other}"))
                }
            })?;
        let url = format!(
            "{}/repos/{}/{}/pulls/{}",
            self.api_base_url, repository.owner, repository.name, pull_request.number
        );
        let metadata = self
            .get(&url, &token.token, "application/vnd.github+json")
            .await?;
        let metadata: PullRequestMetadata = serde_json::from_str(&metadata).map_err(|error| {
            GithubPullRequestDiffError::Other(anyhow::anyhow!("pull request metadata: {error}"))
        })?;
        let patch = self
            .get(&url, &token.token, "application/vnd.github.diff")
            .await?;
        Ok(GithubPullRequestDiff {
            patch,
            range: ChangesetRange {
                repository: Some(repository.https_url()),
                base: metadata.base.into(),
                head: metadata.head.into(),
            },
        })
    }
}

fn status_error(status: StatusCode, body: &str) -> GithubPullRequestDiffError {
    match status {
        StatusCode::NOT_FOUND => GithubPullRequestDiffError::NotFound,
        StatusCode::NOT_ACCEPTABLE => GithubPullRequestDiffError::TooLarge,
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => GithubPullRequestDiffError::Unavailable,
        other => GithubPullRequestDiffError::Other(anyhow::anyhow!(
            "github answered {other}: {}",
            body.chars().take(300).collect::<String>()
        )),
    }
}
