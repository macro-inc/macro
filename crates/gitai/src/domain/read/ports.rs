use upstream_error::UpstreamError;

use crate::domain::models::{DeviceIdentity, GitaiError};
use crate::domain::ports::{IndexStore, IngestMetrics, ObjectStore};
use crate::domain::service::GitaiService;

use super::models::{
    CachedPullRequest, CommitPullRequestLink, GithubBlame, GithubCommit, GithubPullRequest,
    StoredCommit, StoredSession, TranscriptChunk,
};

/// Reads of the index (DynamoDB) for the read API, and its GitHub cache.
pub trait ReadIndex: Send + Sync + 'static {
    /// Adapter failure.
    type Err: std::error::Error + Send + Sync + 'static;

    /// The indexed commits among `shas`, in no particular order.
    fn commits(
        &self,
        shas: &[String],
    ) -> impl Future<Output = Result<Vec<StoredCommit>, Self::Err>> + Send;

    /// The indexed sessions among `ids`, in no particular order.
    fn sessions(
        &self,
        ids: &[String],
    ) -> impl Future<Output = Result<Vec<StoredSession>, Self::Err>> + Send;

    /// A session's transcript chunks in time order, starting at the chunk
    /// with sort key `from` (inclusive) when given.
    fn transcript_chunks(
        &self,
        session_id: &str,
        from: Option<&str>,
    ) -> impl Future<Output = Result<Vec<TranscriptChunk>, Self::Err>> + Send;

    /// The cached commits of a pull request, expired or not.
    fn cached_pull_request(
        &self,
        number: u64,
    ) -> impl Future<Output = Result<Option<CachedPullRequest>, Self::Err>> + Send;

    /// Caches a pull request's commits.
    fn cache_pull_request(
        &self,
        pull_request: &CachedPullRequest,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// The cached pull request link of a commit, expired or not.
    fn cached_commit_link(
        &self,
        sha: &str,
    ) -> impl Future<Output = Result<Option<CommitPullRequestLink>, Self::Err>> + Send;

    /// Caches which pull request a commit names.
    fn cache_commit_link(
        &self,
        link: &CommitPullRequestLink,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// Why a GitHub read failed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum GithubError {
    /// GitHub is down, throttling us, or answered with something unusable.
    #[error(transparent)]
    Upstream(#[from] UpstreamError),
    /// Blame is only in GitHub's GraphQL API, which needs a token, and none
    /// is configured.
    #[error("blame needs a GitHub token")]
    BlameNeedsToken,
}

/// The public repository on GitHub ([`super::models::GITHUB_REPOSITORY`]).
/// `None` means GitHub does not know the commit, pull request or path.
pub trait GithubApi: Send + Sync + 'static {
    /// A commit by full or abbreviated SHA.
    fn commit(
        &self,
        sha: &str,
    ) -> impl Future<Output = Result<Option<GithubCommit>, GithubError>> + Send;

    /// A pull request.
    fn pull_request(
        &self,
        number: u64,
    ) -> impl Future<Output = Result<Option<GithubPullRequest>, GithubError>> + Send;

    /// A pull request's commit SHAs, oldest first (GitHub lists at most 250).
    fn pull_request_commits(
        &self,
        number: u64,
    ) -> impl Future<Output = Result<Vec<String>, GithubError>> + Send;

    /// The blame of `path` at `rev`.
    fn blame(
        &self,
        rev: &str,
        path: &str,
    ) -> impl Future<Output = Result<Option<GithubBlame>, GithubError>> + Send;
}

/// Checks a device credential. [`GitaiService`] is the implementation; the
/// read side reuses it instead of a second credential check.
pub trait DeviceAuthenticator: Send + Sync + 'static {
    /// The identity behind a presented `X-API-Key`; `Unauthorized` when it
    /// is missing, unknown, revoked or the shared key.
    fn authenticate_device(
        &self,
        presented: Option<&str>,
    ) -> impl Future<Output = Result<DeviceIdentity, GitaiError>> + Send;
}

impl<Objects: ObjectStore, Index: IndexStore, Metrics: IngestMetrics> DeviceAuthenticator
    for GitaiService<Objects, Index, Metrics>
{
    fn authenticate_device(
        &self,
        presented: Option<&str>,
    ) -> impl Future<Output = Result<DeviceIdentity, GitaiError>> + Send {
        GitaiService::authenticate_device(self, presented)
    }
}
