//! Port definition for the github sync API client.

use std::future::Future;

use crate::domain::models::{GithubError, GithubInstallationAccessToken};

/// Client interface for making GitHub sync API calls.
///
/// Abstracts HTTP communication with GitHub's API so the service
/// layer does not need to manage its own HTTP client.
pub trait GithubSyncClient: Send + Sync + 'static {
    /// Generates an installation access token for a given GitHub App installation.
    fn generate_installation_access_token(
        &self,
        jwt: &str,
        installation_id: u64,
    ) -> impl Future<Output = Result<GithubInstallationAccessToken, GithubError>> + Send;

    /// Posts a comment on a GitHub pull request (via the issues API).
    fn create_pr_comment(
        &self,
        access_token: &str,
        owner: &str,
        repo: &str,
        pull_number: u64,
        body: &str,
    ) -> impl Future<Output = Result<(), GithubError>> + Send;

    /// Lists comment bodies on a GitHub pull request (via the issues API).
    fn list_pr_comments(
        &self,
        access_token: &str,
        owner: &str,
        repo: &str,
        pull_number: u64,
    ) -> impl Future<Output = Result<Vec<String>, GithubError>> + Send;
}
