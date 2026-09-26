//! Ports for storing GitHub pull requests.

use std::future::Future;

use foreign_entity::domain::models::ForeignEntity;

use super::models::{
    EnrichedGithubPullRequest, GithubPullRequestError, UpsertGithubPullRequest,
    UpsertedGithubPullRequest,
};

/// Stores GitHub pull requests as foreign entity records, one record per user or team the pull
/// request is synced for.
pub trait GithubPullRequestService: Send + Sync + 'static {
    /// Store a pull request's latest data on the record for
    /// [`UpsertGithubPullRequest::stored_for`], creating it when that source has none.
    fn upsert_pull_request(
        &self,
        upsert: UpsertGithubPullRequest,
    ) -> impl Future<Output = Result<UpsertedGithubPullRequest, GithubPullRequestError>> + Send;

    /// Store a pull request's latest data on every record already stored for it, without
    /// creating any. Returns the updated records.
    fn refresh_pull_request(
        &self,
        pull_request: &EnrichedGithubPullRequest,
    ) -> impl Future<Output = Result<Vec<ForeignEntity>, GithubPullRequestError>> + Send;
}
