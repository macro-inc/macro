//! Storage and GitHub capabilities required by the changes service.

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;

use agent_session::domain::model::AgentSession;

use super::error::ExtractError;
use super::model::{
    AgentSessionId, AttemptOutcome, CapturedBranch, Changeset, ExtractedChangeset, SessionChanges,
};
use chrono::{DateTime, Utc};

/// Pending batched branch facts for optional domain composition.
pub type SessionBranchesFuture<'a> = Pin<
    Box<
        dyn Future<Output = Result<HashMap<AgentSessionId, CapturedBranch>, rootcause::Report>>
            + Send
            + 'a,
    >,
>;

/// Batched, persisted working-branch facts for already-authorized sessions.
///
/// Callers must first restrict the ids to sessions the requesting user can view.
/// Missing captures and detached heads have no branch; a session's starting
/// branch is never substituted for its captured working branch.
pub trait SessionBranchReader: Send + Sync + 'static {
    /// Fetch repository and branch facts in one batch without loading patches or file lists.
    fn working_branches<'a>(&'a self, sessions: &'a [AgentSessionId]) -> SessionBranchesFuture<'a>;
}

/// Reads the linked GitHub pull request for a session. The service derives
/// per-file facts from the raw patch.
pub trait ChangesetExtractor: Send + Sync + 'static {
    /// The current diff for `session`, or why there is none.
    fn extract(
        &self,
        session: &AgentSession,
    ) -> impl Future<Output = Result<ExtractedChangeset, ExtractError>> + Send;
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

/// The patch and actual base/head refs of a GitHub pull request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PullRequestDiff {
    /// Git-style unified diff returned by GitHub.
    pub patch: String,
    /// The PR's target and source, including forks and non-default bases.
    pub range: super::model::ChangesetRange,
}

/// Reads a pull request using the session owner's GitHub repository access.
pub trait PullRequestDiffReader: Send + Sync + 'static {
    /// Read the PR itself; never fall back to a branch or workspace diff.
    fn read(
        &self,
        user: &macro_user_id::user_id::MacroUserIdStr<'static>,
        pull_request: &super::model::PullRequestRef,
    ) -> impl Future<Output = Result<PullRequestDiff, super::error::CompareError>> + Send;
}
