//! Read GitHub pull request metadata and its diff with a repository-scoped App token.

use std::time::Duration;

use github::domain::models::GithubError;
use github::domain::ports::{GithubSyncClient, GithubSyncRepo};
use github::domain::service::InstallationTokenService;
use macro_user_id::user_id::MacroUserIdStr;
use reqwest::StatusCode;
use serde::Deserialize;

use crate::domain::error::CompareError;
use crate::domain::model::{ChangesetRange, GitRef, PullRequestRef};
use crate::domain::ports::{PullRequestDiff, PullRequestDiffReader};

#[cfg(test)]
mod test;

const GITHUB_API_BASE_URL: &str = "https://api.github.com";
const READ_PERMISSIONS: &[(&str, &str)] = &[("pull_requests", "read")];
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);

/// GitHub REST adapter for a linked pull request's diff.
pub struct GithubPullRequestDiff<Installations, Client> {
    tokens: InstallationTokenService<Installations, Client>,
    http: reqwest::Client,
    api_base_url: String,
}

impl<Installations: GithubSyncRepo, Client: GithubSyncClient>
    GithubPullRequestDiff<Installations, Client>
{
    /// Mint repository-scoped tokens through the owning GitHub domain service.
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

    async fn get(&self, url: &str, token: &str, accept: &str) -> Result<String, CompareError> {
        let response = self
            .http
            .get(url)
            .bearer_auth(token)
            .header("Accept", accept)
            .header("User-Agent", "Macro-Agent-Changes")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .send()
            .await
            .map_err(|error| CompareError::Other(rootcause::report!(error).into()))?;
        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|error| CompareError::Other(rootcause::report!(error).into()))?;
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

impl<Installations: GithubSyncRepo, Client: GithubSyncClient> PullRequestDiffReader
    for GithubPullRequestDiff<Installations, Client>
{
    #[tracing::instrument(skip_all, err)]
    async fn read(
        &self,
        user: &MacroUserIdStr<'static>,
        pull_request: &PullRequestRef,
    ) -> Result<PullRequestDiff, CompareError> {
        let repository = &pull_request.repository;
        let token = self
            .tokens
            .for_repository(user, &repository.owner, &repository.name, READ_PERMISSIONS)
            .await
            .map_err(|error| match error {
                GithubError::RepositoryUnavailable => CompareError::Unavailable,
                other => CompareError::Other(rootcause::report!("github token: {other}")),
            })?;
        let url = format!(
            "{}/repos/{}/{}/pulls/{}",
            self.api_base_url, repository.owner, repository.name, pull_request.number
        );
        let metadata = self
            .get(&url, &token.token, "application/vnd.github+json")
            .await?;
        let metadata: PullRequestMetadata = serde_json::from_str(&metadata).map_err(|error| {
            CompareError::Other(rootcause::report!("pull request metadata: {error}"))
        })?;
        let patch = self
            .get(&url, &token.token, "application/vnd.github.diff")
            .await?;
        Ok(PullRequestDiff {
            patch,
            range: ChangesetRange {
                repository: Some(repository.https_url()),
                base: metadata.base.into(),
                head: metadata.head.into(),
            },
        })
    }
}

fn status_error(status: StatusCode, body: &str) -> CompareError {
    match status {
        StatusCode::NOT_FOUND => CompareError::NotFound,
        StatusCode::NOT_ACCEPTABLE => CompareError::TooLarge,
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => CompareError::Unavailable,
        other => CompareError::Other(rootcause::report!(
            "github answered {other}: {}",
            body.chars().take(300).collect::<String>()
        )),
    }
}
