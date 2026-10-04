//! Ports for storing GitHub pull requests.

use std::future::Future;

use entity_access::domain::models::{EntityAccessReceipt, MemberTeamRole, ViewAccessLevel};
use foreign_entity::domain::{
    models::{ForeignEntity, SourceId},
    ports::ForeignEntityListQuery,
};
use item_filters::ast::{LiteralTree, github_pull_request::GithubPullRequestLiteral};
use macro_user_id::user_id::MacroUserIdStr;

use super::models::{
    EnrichedGithubPullRequest, GithubPullRequestChangesError, GithubPullRequestChangeset,
    GithubPullRequestDiff, GithubPullRequestDiffError, GithubPullRequestError,
    GithubPullRequestFacets, GithubPullRequestRow, GithubPullRequestSortDirection,
    GithubPullRequestWrite, GithubRepositoryIdentity, PullRequestIndexOutcome,
    PullRequestIndexRecord, PullRequestIndexSummary, PullRequestRef, StoredGithubPullRequest,
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
    ///
    /// Attempts every record even when an individual refresh fails. Logs each failed record
    /// and returns the first error after completing the remaining refreshes.
    fn refresh_pull_request(
        &self,
        pull_request: &EnrichedGithubPullRequest,
    ) -> impl Future<Output = Result<Vec<ForeignEntity>, GithubPullRequestError>> + Send;

    /// The pull request behind the record `receipt` grants view access to. A record that is not
    /// a pull request is not found.
    fn get_pull_request(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> impl Future<Output = Result<StoredGithubPullRequest, GithubPullRequestError>> + Send;
}

/// Initializes missing typed rows from identity-verified source records; never refreshes existing rows.
pub trait GithubPullRequestIndexer: Send + Sync + 'static {
    /// Reconstruct missing rows from all verified source records of `repositories`.
    /// Missing source identity remains untyped. Independent failures are counted and logged.
    fn index_repositories(
        &self,
        repositories: &[GithubRepositoryIdentity],
    ) -> impl Future<Output = Result<PullRequestIndexSummary, GithubPullRequestError>> + Send;
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

    /// Atomically merge supplied typed columns with the shared row. Omitted fields retain
    /// stored values. Concurrent creation and updates for the same key serialize before reading.
    /// A provided base/head ref replaces its name and SHA together, including missing components.
    /// A non-null stored identity cannot be reassigned. A case-only fallback requires the same
    /// verified identity and retains the stored key; repository renames remain a separate operation.
    fn upsert_row(
        &self,
        row: &GithubPullRequestWrite,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Move the row stored under `from` to `to`. When `to` already has a row, the row under
    /// `from` is removed instead.
    fn rename_row(
        &self,
        from: &str,
        to: &str,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// The row stored for `github_key`, if the pull request has one.
    fn pull_request_row(
        &self,
        github_key: &str,
    ) -> impl Future<Output = Result<Option<GithubPullRequestRow>, Self::Err>> + Send;
}

/// Reads the stored pull request records the indexer writes rows from.
pub trait GithubPullRequestIndexRepository: Send + Sync + 'static {
    /// Error type returned by repository operations.
    type Err: Into<anyhow::Error> + Send + std::fmt::Debug;

    /// All PR source records under `owner/name`, compared case-insensitively and literally.
    /// Retain older and case-variant records for domain validation and sparse reconstruction.
    fn pull_request_index_records(
        &self,
        owner: &str,
        name: &str,
    ) -> impl Future<Output = Result<Vec<PullRequestIndexRecord>, Self::Err>> + Send;

    /// Atomically initialize a verified row only if its key and stable identity are absent.
    /// Serialize case-insensitive keys before checking, including concurrent creation.
    /// Return AlreadyPresent only for an unambiguous matching key, repository ID, and number.
    /// Different-key stable identities, conflicting IDs, and unverified existing rows conflict.
    /// Never update, delete, or rename existing rows, including their timestamps.
    fn initialize_indexed_row(
        &self,
        row: &GithubPullRequestRow,
    ) -> impl Future<Output = Result<PullRequestIndexOutcome, Self::Err>> + Send;
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

/// Reads a pull request's diff from GitHub with a user's repository access.
pub trait GithubPullRequestDiffReader: Send + Sync + 'static {
    /// The pull request's patch and actual base and head, read through the GitHub App on
    /// `user`'s behalf. Never falls back to a branch or workspace diff.
    fn read(
        &self,
        user: &MacroUserIdStr<'static>,
        pull_request: &PullRequestRef,
    ) -> impl Future<Output = Result<GithubPullRequestDiff, GithubPullRequestDiffError>> + Send;
}

/// Stores the summary of each pull request changeset.
pub trait GithubPullRequestChangesetRepository: Send + Sync + 'static {
    /// Error type returned by repository operations.
    type Err: Into<anyhow::Error> + Send + std::fmt::Debug;

    /// The changeset stored under `id`, if any.
    fn get_changeset(
        &self,
        id: uuid::Uuid,
    ) -> impl Future<Output = Result<Option<GithubPullRequestChangeset>, Self::Err>> + Send;

    /// Store `changeset`, unless a changeset with its id is already stored.
    fn insert_changeset(
        &self,
        changeset: &GithubPullRequestChangeset,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// Stores pull request patches, which can be megabytes and are read whole or not at all.
pub trait GithubPullRequestPatchStore: Send + Sync + 'static {
    /// Error type returned by store operations.
    type Err: Into<anyhow::Error> + Send + std::fmt::Debug;

    /// The patch under `key`, or `None` when nothing is stored there, for example because it
    /// expired.
    fn get_patch(
        &self,
        key: &str,
    ) -> impl Future<Output = Result<Option<String>, Self::Err>> + Send;

    /// Store `patch` under `key`, replacing whatever was there.
    fn put_patch(
        &self,
        key: &str,
        patch: &str,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// Pull request changesets for callers that authorized their own access, such as agent
/// sessions linked to a pull request. The diff is read with `user`'s GitHub repository access.
pub trait GithubPullRequestChangesets: Send + Sync + 'static {
    /// The changeset stored under `id`, if any.
    fn changeset(
        &self,
        id: uuid::Uuid,
    ) -> impl Future<
        Output = Result<Option<GithubPullRequestChangeset>, GithubPullRequestChangesError>,
    > + Send;

    /// Read the pull request's current diff and store it, once per base and head.
    fn capture(
        &self,
        user: &MacroUserIdStr<'static>,
        pull_request: &PullRequestRef,
    ) -> impl Future<Output = Result<GithubPullRequestChangeset, GithubPullRequestChangesError>> + Send;

    /// The patch of the changeset under `id`, read again from GitHub when the stored copy
    /// expired. [`GithubPullRequestChangesError::Moved`] when the pull request no longer has
    /// that base and head.
    fn patch(
        &self,
        user: &MacroUserIdStr<'static>,
        id: uuid::Uuid,
    ) -> impl Future<Output = Result<String, GithubPullRequestChangesError>> + Send;
}

/// A pull request's changes, for callers with view access to one of its records.
pub trait GithubPullRequestChanges: Send + Sync + 'static {
    /// The changes of the pull request behind the record `receipt` grants view access to, at its
    /// current base and head.
    fn changes(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> impl Future<Output = Result<GithubPullRequestChangeset, GithubPullRequestChangesError>> + Send;

    /// The patch of the changeset `changeset`, which must belong to the pull request behind the
    /// record `receipt` grants view access to.
    fn patch(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        changeset: uuid::Uuid,
    ) -> impl Future<Output = Result<String, GithubPullRequestChangesError>> + Send;
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
