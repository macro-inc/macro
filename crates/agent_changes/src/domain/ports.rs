//! The capabilities the changes service requires from the outside.
//!
//! [`ChangesetExtractor`] is the one port every harness answers: given a
//! session, hand back the patch between where the work started and where it
//! is now. Everything harness-specific - talking to Cursor, to a daemon, to a
//! sandbox - lives behind it, so the service, the storage, and the pane never
//! learn how any particular runtime keeps its files.

use std::future::Future;

use agent_session::domain::model::AgentSession;
use macro_user_id::user_id::MacroUserIdStr;

use super::error::{CompareError, ExtractError};
use super::model::{
    AgentSessionId, AttemptOutcome, Changeset, ExtractedChangeset, PullRequestDraft,
    RepositorySlug, SessionChanges,
};
use chrono::{DateTime, Utc};

/// Reads a session's changes from wherever its harness keeps them.
///
/// Implemented once per harness family and once more by a router that picks
/// the family from the session row. Extractors return the raw patch; the
/// service derives every per-file fact from it, so an extractor never counts
/// lines or classifies files.
pub trait ChangesetExtractor: Send + Sync + 'static {
    /// The current diff for `session`, or why there is none.
    fn extract(
        &self,
        session: &AgentSession,
    ) -> impl Future<Output = Result<ExtractedChangeset, ExtractError>> + Send;
}

/// An extractor for harnesses that expose no files. Every session is
/// [`ExtractError::Unsupported`].
#[derive(Debug, Clone, Copy, Default)]
pub struct UnsupportedExtractor;

impl ChangesetExtractor for UnsupportedExtractor {
    async fn extract(&self, session: &AgentSession) -> Result<ExtractedChangeset, ExtractError> {
        Err(ExtractError::Unsupported {
            harness: session.harness.clone(),
        })
    }
}

/// Where a stored patch lives in the blob store.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct PatchBlobKey(String);

impl PatchBlobKey {
    /// The key for a capture's patch: one object per capture, under the
    /// session, so an older capture's readers are never handed a newer body.
    #[must_use]
    pub fn for_changeset(session: AgentSessionId, changeset: super::model::ChangesetId) -> Self {
        Self(format!(
            "agent-sessions/{session}/changes/{changeset}.patch"
        ))
    }

    /// Wrap a key read back from storage.
    #[must_use]
    pub fn from_stored(key: String) -> Self {
        Self(key)
    }

    /// The key as the blob store spells it.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for PatchBlobKey {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

/// The summary row: one per session, replaced on every capture.
pub trait ChangesetRepo: Send + Sync + 'static {
    /// Note that a capture started at `started_at`. Creates the session's
    /// row when this is its first attempt; an earlier changeset stays put.
    fn begin_attempt(
        &self,
        session: AgentSessionId,
        started_at: DateTime<Utc>,
    ) -> impl Future<Output = Result<(), rootcause::Report>> + Send;

    /// Replace the session's changeset with `changeset`, whose patch (if any)
    /// is stored under `patch_key`, and close the running attempt as
    /// captured. Returns the key of the patch this one superseded, so the
    /// caller can delete the orphaned blob.
    fn record_changeset(
        &self,
        changeset: &Changeset,
        patch_key: Option<&PatchBlobKey>,
        finished_at: DateTime<Utc>,
    ) -> impl Future<Output = Result<Option<PatchBlobKey>, rootcause::Report>> + Send;

    /// Close the running attempt without a changeset: what went wrong, in a
    /// word and in a sentence the user can read. An earlier changeset stays.
    fn record_failure(
        &self,
        session: AgentSessionId,
        outcome: AttemptOutcome,
        error: Option<&str>,
        finished_at: DateTime<Utc>,
    ) -> impl Future<Output = Result<(), rootcause::Report>> + Send;

    /// The session's latest changeset and attempt, or an empty
    /// [`SessionChanges`] for a session nothing was ever captured for.
    fn get(
        &self,
        session: AgentSessionId,
    ) -> impl Future<Output = Result<SessionChanges, rootcause::Report>> + Send;

    /// Where the session's current patch is stored, if it has one.
    fn patch_key(
        &self,
        session: AgentSessionId,
    ) -> impl Future<Output = Result<Option<PatchBlobKey>, rootcause::Report>> + Send;
}

/// The patch bodies, kept out of the database because a patch can be
/// megabytes and is read as a whole or not at all.
pub trait ChangesetBlobStore: Send + Sync + 'static {
    /// Store `patch` under `key`, replacing whatever was there.
    fn put_patch(
        &self,
        key: &PatchBlobKey,
        patch: &str,
    ) -> impl Future<Output = Result<(), rootcause::Report>> + Send;

    /// The patch under `key`, or `None` when nothing is stored there.
    fn get_patch(
        &self,
        key: &PatchBlobKey,
    ) -> impl Future<Output = Result<Option<String>, rootcause::Report>> + Send;

    /// Remove the patch under `key`. Removing a missing key succeeds.
    fn delete_patch(
        &self,
        key: &PatchBlobKey,
    ) -> impl Future<Output = Result<(), rootcause::Report>> + Send;
}

/// What a repository provider says about a range.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepositoryComparison {
    /// The git-style unified diff from `base` to `head`.
    pub patch: String,
    /// The commit `base` resolved to, when the provider says.
    pub base_sha: Option<String>,
    /// The commit `head` resolved to, when the provider says.
    pub head_sha: Option<String>,
}

/// Compares two refs of a repository the user reaches through Macro's
/// GitHub App. How a pushed branch becomes a patch without a checkout.
pub trait RepositoryCompare: Send + Sync + 'static {
    /// The branch a clone of `repository` checks out.
    fn default_branch(
        &self,
        user: &MacroUserIdStr<'static>,
        repository: &RepositorySlug,
    ) -> impl Future<Output = Result<String, CompareError>> + Send;

    /// The diff from `base` to `head` (three-dot compare: what `head` has
    /// that `base` does not).
    fn compare(
        &self,
        user: &MacroUserIdStr<'static>,
        repository: &RepositorySlug,
        base: &str,
        head: &str,
    ) -> impl Future<Output = Result<RepositoryComparison, CompareError>> + Send;
}

/// Writes the pull request a changeset would open.
pub trait PullRequestDraftGenerator: Send + Sync + 'static {
    /// A title and body for `changeset`, read from its patch and the
    /// session's name.
    fn draft(
        &self,
        session: &AgentSession,
        changeset: &Changeset,
        patch: &str,
    ) -> impl Future<Output = Result<PullRequestDraft, rootcause::Report>> + Send;
}

/// A drafter for deployments without a model: always an error the pane
/// shows as "write it yourself".
#[derive(Debug, Clone, Copy, Default)]
pub struct NoPullRequestDrafts;

impl PullRequestDraftGenerator for NoPullRequestDrafts {
    async fn draft(
        &self,
        _session: &AgentSession,
        _changeset: &Changeset,
        _patch: &str,
    ) -> Result<PullRequestDraft, rootcause::Report> {
        Err(rootcause::report!(
            "pull request drafting is not configured on this deployment"
        ))
    }
}
