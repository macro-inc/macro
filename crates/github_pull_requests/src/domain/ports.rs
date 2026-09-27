//! Ports for storing GitHub pull requests.

use std::future::Future;

use entity_access::domain::models::{EntityAccessReceipt, MemberTeamRole};
use foreign_entity::domain::{
    models::{ForeignEntity, SourceId},
    ports::ForeignEntityListQuery,
};
use item_filters::ast::{LiteralTree, github_pull_request::GithubPullRequestLiteral};
use macro_user_id::user_id::MacroUserIdStr;

use super::models::{
    EnrichedGithubPullRequest, GithubPullRequestError, GithubPullRequestFacets,
    GithubPullRequestRow, GithubPullRequestSortDirection, GithubRepositoryIdentity,
    UpsertGithubPullRequest, UpsertedGithubPullRequest,
};

/// Stores GitHub pull requests as foreign entity records, one record per user or team the pull
/// request is synced for.
pub trait GithubPullRequestService: Send + Sync + 'static {
    /// Store a pull request's latest data on the record for
    /// [`UpsertGithubPullRequest::stored_for`], creating it when that source has none.
    ///
    /// A pull request whose repository was renamed or transferred keeps its records: they are
    /// found by repository id and number and moved to the new key.
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

/// Writes typed rows for pull requests stored before rows existed.
pub trait GithubPullRequestIndexer: Send + Sync + 'static {
    /// Write rows for the stored pull requests of each of `repositories`, matched by owner and
    /// name. Returns how many rows were written.
    fn index_repositories(
        &self,
        repositories: &[GithubRepositoryIdentity],
    ) -> impl Future<Output = Result<u64, GithubPullRequestError>> + Send;
}

/// Persists the typed columns of pull requests.
pub trait GithubPullRequestRepository: Send + Sync + 'static {
    /// Error type returned by repository operations.
    type Err: Into<anyhow::Error> + Send + std::fmt::Debug;

    /// The key of pull request `number` in the repository with id `repository_id`.
    fn github_key_for(
        &self,
        repository_id: i64,
        number: i64,
    ) -> impl Future<Output = Result<Option<String>, Self::Err>> + Send;

    /// Store a pull request's typed columns. A row without a repository id keeps the one it
    /// has.
    fn upsert_row(
        &self,
        row: &GithubPullRequestRow,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Move the row stored under `from` to `to`. When `to` already has a row, the row under
    /// `from` is removed instead.
    fn rename_row(
        &self,
        from: &str,
        to: &str,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// Reads the stored pull request records the indexer writes rows from.
pub trait GithubPullRequestIndexRepository: Send + Sync + 'static {
    /// Error type returned by repository operations.
    type Err: Into<anyhow::Error> + Send + std::fmt::Debug;

    /// The metadata of the most recently updated record of each pull request stored under the
    /// repository `owner/name`, compared case-insensitively.
    fn latest_pull_request_metadata(
        &self,
        owner: &str,
        name: &str,
    ) -> impl Future<Output = Result<Vec<serde_json::Value>, Self::Err>> + Send;
}

/// Lists the GitHub pull requests a caller can see.
pub trait GithubPullRequestListing: Send + Sync + 'static {
    /// Up to `limit` pull request records stored for one of `source_ids` and matching `query`,
    /// one per pull request, in the query's sort order and `sort_direction`; a cursor in `query`
    /// continues in that direction. `requesting_user` scopes the
    /// participant and notification-state filters; without one they match nothing.
    /// `github_pull_request_filter` keeps only pull requests whose typed columns match it.
    /// "Updated" sorts by, and reports, GitHub's updated time when the pull request has one.
    fn list_pull_requests(
        &self,
        requesting_user: Option<String>,
        source_ids: Vec<SourceId>,
        limit: u32,
        query: ForeignEntityListQuery,
        github_pull_request_filter: LiteralTree<GithubPullRequestLiteral>,
        sort_direction: GithubPullRequestSortDirection,
    ) -> impl Future<Output = Result<Vec<ForeignEntity>, GithubPullRequestError>> + Send;
}

/// Reads pull request records for listings.
pub trait GithubPullRequestListingRepository: Send + Sync + 'static {
    /// Error type returned by repository operations.
    type Err: Into<anyhow::Error> + Send + std::fmt::Debug;

    /// Up to `limit` pull request records stored for one of `source_ids` and matching `query`
    /// and `github_pull_request_filter`, one per pull request, in the query's sort order and
    /// `sort_direction`.
    fn list_pull_requests(
        &self,
        requesting_user: Option<String>,
        source_ids: Vec<SourceId>,
        limit: u32,
        query: ForeignEntityListQuery,
        github_pull_request_filter: LiteralTree<GithubPullRequestLiteral>,
        sort_direction: GithubPullRequestSortDirection,
    ) -> impl Future<Output = Result<Vec<ForeignEntity>, Self::Err>> + Send;
}

/// Aggregate views over the GitHub pull requests a caller can see.
pub trait GithubPullRequestFacetService: Send + Sync + 'static {
    /// Repositories and authors among the pull requests visible to `user`, plus those visible
    /// to `team` when the caller is acting within one. A pull request visible to both counts
    /// once.
    fn github_pull_request_facets(
        &self,
        user: MacroUserIdStr<'static>,
        team: Option<EntityAccessReceipt<MemberTeamRole>>,
    ) -> impl Future<Output = Result<GithubPullRequestFacets, GithubPullRequestError>> + Send;
}

/// Aggregates over the pull request rows visible to a set of sources.
pub trait GithubPullRequestFacetRepository: Send + Sync + 'static {
    /// Error type returned by repository operations.
    type Err: Into<anyhow::Error> + Send + std::fmt::Debug;

    /// Count distinct pull requests per repository and per author among the pull requests
    /// with a record stored for any of `source_ids`.
    fn github_pull_request_facets(
        &self,
        source_ids: Vec<SourceId>,
    ) -> impl Future<Output = Result<GithubPullRequestFacets, Self::Err>> + Send;
}
