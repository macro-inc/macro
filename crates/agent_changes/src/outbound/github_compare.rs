//! Comparing two refs of a GitHub repository, as the App the user installed.
//!
//! How a Cursor cloud agent's work becomes a patch without a checkout: Cursor
//! pushes a branch, GitHub renders `base...head` as a diff, and the token
//! that reads it is minted by the `github` crate for one repository the user
//! reaches - the same service the egress proxy mints clone credentials with.

use std::time::Duration;

use github::domain::models::GithubError;
use github::domain::ports::{GithubSyncClient, GithubSyncRepo};
use github::domain::service::InstallationTokenService;
use macro_user_id::user_id::MacroUserIdStr;
use reqwest::StatusCode;

use crate::domain::error::CompareError;
use crate::domain::model::RepositorySlug;
use crate::domain::ports::{RepositoryCompare, RepositoryComparison};

#[cfg(test)]
mod test;

const GITHUB_API_BASE_URL: &str = "https://api.github.com";
const USER_AGENT: &str = "Macro-Agent-Changes";
const API_VERSION: &str = "2022-11-28";
/// A compare of a large branch can take GitHub a while to render.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);

/// Reading the code and the repository's metadata is all a compare needs.
const READ_PERMISSIONS: &[(&str, &str)] = &[("contents", "read"), ("metadata", "read")];

/// [`RepositoryCompare`] over GitHub's REST API.
pub struct GithubRepositoryCompare<Installations, Client> {
    tokens: InstallationTokenService<Installations, Client>,
    http: reqwest::Client,
    api_base_url: String,
}

impl<Installations, Client> GithubRepositoryCompare<Installations, Client>
where
    Installations: GithubSyncRepo,
    Client: GithubSyncClient,
{
    /// Compare through tokens minted by `tokens`.
    pub fn new(tokens: InstallationTokenService<Installations, Client>) -> Self {
        Self::with_api_base_url(tokens, GITHUB_API_BASE_URL.to_owned())
    }

    /// Point the client at another API origin, for tests.
    pub fn with_api_base_url(
        tokens: InstallationTokenService<Installations, Client>,
        api_base_url: String,
    ) -> Self {
        Self {
            tokens,
            http: reqwest::Client::builder()
                .timeout(REQUEST_TIMEOUT)
                .build()
                .expect("the GitHub compare reqwest client should build"),
            api_base_url,
        }
    }

    async fn token(
        &self,
        user: &MacroUserIdStr<'static>,
        repository: &RepositorySlug,
    ) -> Result<String, CompareError> {
        self.tokens
            .for_repository(user, &repository.owner, &repository.name, READ_PERMISSIONS)
            .await
            .map(|token| token.token)
            .map_err(|error| match error {
                GithubError::RepositoryUnavailable => CompareError::Unavailable,
                other => CompareError::Other(rootcause::report!("github token: {other}")),
            })
    }

    fn get(&self, url: &str, token: &str, accept: &str) -> reqwest::RequestBuilder {
        self.http
            .get(url)
            .header("Authorization", format!("Bearer {token}"))
            .header("Accept", accept)
            .header("User-Agent", USER_AGENT)
            .header("X-GitHub-Api-Version", API_VERSION)
    }

    fn repository_url(&self, repository: &RepositorySlug) -> String {
        format!(
            "{}/repos/{}/{}",
            self.api_base_url, repository.owner, repository.name
        )
    }
}

/// Map a non-success status to the domain's words for it.
fn status_error(status: StatusCode, body: &str) -> CompareError {
    match status {
        StatusCode::NOT_FOUND => CompareError::NotFound,
        // GitHub answers a diff it will not render (too many files, too
        // many bytes) with 406 Not Acceptable.
        StatusCode::NOT_ACCEPTABLE => CompareError::TooLarge,
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => CompareError::Unavailable,
        other => CompareError::Other(rootcause::report!(
            "github answered {other}: {}",
            body.chars().take(300).collect::<String>()
        )),
    }
}

impl<Installations, Client> RepositoryCompare for GithubRepositoryCompare<Installations, Client>
where
    Installations: GithubSyncRepo,
    Client: GithubSyncClient,
{
    #[tracing::instrument(skip(self), err, fields(%repository))]
    async fn default_branch(
        &self,
        user: &MacroUserIdStr<'static>,
        repository: &RepositorySlug,
    ) -> Result<String, CompareError> {
        let token = self.token(user, repository).await?;
        let response = self
            .get(
                &self.repository_url(repository),
                &token,
                "application/vnd.github+json",
            )
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
        let repository: serde_json::Value = serde_json::from_str(&body)
            .map_err(|error| CompareError::Other(rootcause::report!("repository body: {error}")))?;
        repository
            .get("default_branch")
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned)
            .ok_or_else(|| {
                CompareError::Other(rootcause::report!(
                    "the repository record names no default branch"
                ))
            })
    }

    #[tracing::instrument(skip(self), err, fields(%repository, base, head))]
    async fn compare(
        &self,
        user: &MacroUserIdStr<'static>,
        repository: &RepositorySlug,
        base: &str,
        head: &str,
    ) -> Result<RepositoryComparison, CompareError> {
        let token = self.token(user, repository).await?;
        let compare_url = format!(
            "{}/compare/{}...{}",
            self.repository_url(repository),
            encode_ref(base),
            encode_ref(head)
        );
        let response = self
            .get(&compare_url, &token, "application/vnd.github.diff")
            .send()
            .await
            .map_err(|error| CompareError::Other(rootcause::report!(error).into()))?;
        let status = response.status();
        let patch = response
            .text()
            .await
            .map_err(|error| CompareError::Other(rootcause::report!(error).into()))?;
        if !status.is_success() {
            return Err(status_error(status, &patch));
        }

        // The commit each side resolved to is a nicety for the pane, so a
        // failure here is logged, not raised: the patch is already in hand.
        let head_sha = self.branch_sha(&token, repository, head).await;
        Ok(RepositoryComparison {
            patch,
            base_sha: None,
            head_sha,
        })
    }
}

impl<Installations, Client> GithubRepositoryCompare<Installations, Client>
where
    Installations: GithubSyncRepo,
    Client: GithubSyncClient,
{
    async fn branch_sha(
        &self,
        token: &str,
        repository: &RepositorySlug,
        branch: &str,
    ) -> Option<String> {
        let url = format!(
            "{}/branches/{}",
            self.repository_url(repository),
            encode_ref(branch)
        );
        let response = self
            .get(&url, token, "application/vnd.github+json")
            .send()
            .await
            .inspect_err(|error| tracing::debug!(error = ?error, branch, "branch lookup failed"))
            .ok()?;
        if !response.status().is_success() {
            tracing::debug!(status = %response.status(), branch, "branch lookup refused");
            return None;
        }
        let body: serde_json::Value = response.json().await.ok()?;
        body.get("commit")?.get("sha")?.as_str().map(str::to_owned)
    }
}

/// A ref as a URL path segment. Slashes inside branch names are kept
/// literal - GitHub resolves `compare/main...agent/work` - while anything
/// else outside the unreserved set is percent-encoded.
fn encode_ref(reference: &str) -> String {
    reference
        .split('/')
        .map(|segment| {
            url::form_urlencoded::byte_serialize(segment.as_bytes())
                .collect::<String>()
                .replace('+', "%20")
        })
        .collect::<Vec<_>>()
        .join("/")
}
