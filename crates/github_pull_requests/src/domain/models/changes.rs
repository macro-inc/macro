//! A pull request's changes at one base and head.

use chrono::{DateTime, Utc};
use git_patch::ChangedFile;
use uuid::Uuid;

use super::{
    ChangesetRange, GithubKey, GithubPullRequestDiffError, GithubPullRequestError, PullRequestRef,
};

#[cfg(test)]
mod test;

/// A pull request's changes between one base commit and one head commit: every changed file,
/// and where the patch is stored.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GithubPullRequestChangeset {
    /// Derived from the pull request and both commits by [`changeset_id`].
    pub id: Uuid,
    /// The pull request's `owner/repo/pull/number` key when the changes were read.
    pub github_key: String,
    /// The pull request the changes belong to.
    pub pull_request: PullRequestRef,
    /// The commits compared.
    pub range: ChangesetRange,
    /// Every changed file, in patch order.
    pub files: Vec<ChangedFile>,
    /// Lines added across all files.
    pub additions: u32,
    /// Lines removed across all files.
    pub deletions: u32,
    /// Size of the stored patch. Zero when nothing changed.
    pub patch_bytes: u64,
    /// Some files' hunks were left out of the stored patch to fit the size budget.
    pub truncated: bool,
    /// Where the patch is stored; `None` when nothing changed.
    pub patch_key: Option<String>,
    /// When the changes were read from GitHub.
    pub captured_at: DateTime<Utc>,
}

/// The id of a pull request's changes between `base_sha` and `head_sha`. The same pull request
/// and commits always give the same id, so a range is stored once whoever reads it.
#[must_use]
pub fn changeset_id(pull_request: &PullRequestRef, base_sha: &str, head_sha: &str) -> Uuid {
    let name = format!(
        "{}/pull/{}/changes/{base_sha}...{head_sha}",
        pull_request.repository.https_url().to_ascii_lowercase(),
        pull_request.number,
    );
    Uuid::new_v5(&Uuid::NAMESPACE_URL, name.as_bytes())
}

/// Where the patch of a pull request's changes between `base_sha` and `head_sha` is stored.
#[must_use]
pub fn changeset_patch_key(
    pull_request: &PullRequestRef,
    base_sha: &str,
    head_sha: &str,
) -> String {
    format!(
        "pull-requests/{}/{}/{}/{base_sha}...{head_sha}.patch",
        pull_request.repository.owner.to_ascii_lowercase(),
        pull_request.repository.name.to_ascii_lowercase(),
        pull_request.number,
    )
}

/// The `owner/repo/pull/number` key of `pull_request`.
#[must_use]
pub fn github_key_of(pull_request: &PullRequestRef) -> String {
    GithubKey::new(
        &pull_request.repository.owner,
        &pull_request.repository.name,
        pull_request.number.get(),
    )
    .to_string()
}

/// Why a pull request's changes could not be served.
#[derive(Debug, thiserror::Error)]
pub enum GithubPullRequestChangesError {
    /// The record is not a pull request the caller can see, or the changes are not its.
    #[error("pull request changes not found")]
    NotFound,
    /// Reading changes needs an authenticated user, whose GitHub access the diff is read with.
    #[error("reading pull request changes needs an authenticated user")]
    Unauthorized,
    /// GitHub could not provide the diff.
    #[error(transparent)]
    Diff(#[from] GithubPullRequestDiffError),
    /// The pull request moved past the requested changes, and their stored patch expired.
    #[error("the pull request has changed since these changes were read")]
    Moved,
    /// Reading the pull request failed.
    #[error(transparent)]
    PullRequest(#[from] GithubPullRequestError),
    /// Storing or reading changes failed.
    #[error("pull request changes storage failed: {0}")]
    Storage(anyhow::Error),
}
