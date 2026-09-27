//! The vocabulary of a session's changes.
//!
//! A [`Changeset`] is one capture of everything a session has changed in its
//! repository: the per-file facts a review needs at a glance (path, status,
//! line counts) plus where the patch itself is stored. Only the latest capture
//! is kept per session - the Changes pane shows the current state of the
//! linked pull request, not a history of captures.

use chrono::{DateTime, Utc};
use macro_uuid::Uuid;
use serde::{Deserialize, Serialize};

pub use agent_session::domain::model::AgentSessionId;
pub use git_patch::{ChangedFile, ChangesetRange, FileChangeKind, GitRef};
pub use github_pull_requests::domain::models::{PullRequestRef, RepositorySlug};

/// A captured branch together with the repository it belongs to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CapturedBranch {
    /// The repository of the linked pull request when the diff was captured.
    pub repository_url: String,
    /// The captured head branch, never the selected starting branch.
    pub branch: String,
}

impl CapturedBranch {
    /// Use a historical fact only while it still describes the current repository.
    pub fn for_repository(&self, repository_url: &str) -> Option<&str> {
        let current = RepositorySlug::parse(repository_url)?;
        let captured = RepositorySlug::parse(&self.repository_url)?;
        (current.owner.eq_ignore_ascii_case(&captured.owner)
            && current.name.eq_ignore_ascii_case(&captured.name))
        .then_some(self.branch.as_str())
    }
}

/// Identity of one capture. Minted per capture (UUIDv7), so the patch blob's
/// key changes every time and a reader never sees half of a newer capture
/// under an older summary.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ChangesetId(Uuid);

impl ChangesetId {
    /// Mint a fresh id, backed by a UUIDv7.
    #[expect(clippy::new_without_default, reason = "each call mints a distinct id")]
    #[must_use]
    pub fn new() -> Self {
        Self(macro_uuid::generate_uuid_v7())
    }

    /// Wrap an existing UUID.
    #[must_use]
    pub fn from_uuid(id: Uuid) -> Self {
        Self(id)
    }

    /// The underlying UUID.
    #[must_use]
    pub fn as_uuid(&self) -> Uuid {
        self.0
    }
}

impl std::fmt::Display for ChangesetId {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(formatter)
    }
}

/// The source of the captured diff.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, strum::Display, strum::EnumString,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum ChangesetSource {
    /// The diff of the session's linked GitHub pull request.
    GithubPullRequest,
}

/// What an extractor hands back: the raw patch plus the range it covers. The
/// service derives every per-file fact from the patch, so no extractor has to
/// count lines or classify files itself.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExtractedChangeset {
    /// Where it came from.
    pub source: ChangesetSource,
    /// What was compared.
    pub range: ChangesetRange,
    /// A git-style unified diff, possibly empty when nothing changed.
    pub patch: String,
    /// The extractor already cut the patch down to a size budget of its
    /// own, so files past its cut are missing from `patch` entirely.
    pub truncated: bool,
}

/// One capture of a session's changes, as stored and served.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Changeset {
    /// This capture's id.
    pub id: ChangesetId,
    /// The session whose changes these are.
    pub session: AgentSessionId,
    /// Where it came from.
    pub source: ChangesetSource,
    /// What was compared.
    pub range: ChangesetRange,
    /// Every changed file, in patch order.
    pub files: Vec<ChangedFile>,
    /// Lines added across all files.
    pub additions: u32,
    /// Lines removed across all files.
    pub deletions: u32,
    /// Size of the stored patch. Zero when nothing changed.
    pub patch_bytes: u64,
    /// Some files' hunks were dropped to fit the size budget.
    pub truncated: bool,
    /// When the extractor took the diff.
    pub captured_at: DateTime<Utc>,
}

impl Changeset {
    /// Whether there is a patch to fetch at all.
    #[must_use]
    pub fn has_patch(&self) -> bool {
        self.patch_bytes > 0
    }
}

/// How the latest capture attempt ended.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, strum::Display, strum::EnumString,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum AttemptOutcome {
    /// A changeset was stored (possibly an empty one).
    Captured,
    /// The linked pull request is missing or unavailable.
    NotReady,
    /// The extractor or storage failed.
    Failed,
}

/// The latest attempt to capture a session's changes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CaptureAttempt {
    /// When it started.
    pub started_at: DateTime<Utc>,
    /// When it ended, or `None` while it runs.
    pub finished_at: Option<DateTime<Utc>>,
    /// How it ended, or `None` while it runs.
    pub outcome: Option<AttemptOutcome>,
    /// A user-presentable reason for a non-captured outcome.
    pub error: Option<String>,
}

impl CaptureAttempt {
    /// Whether the attempt is still running.
    #[must_use]
    pub fn in_flight(&self) -> bool {
        self.finished_at.is_none()
    }
}

/// Everything the Changes pane asks for at once: the latest changeset, if one
/// was ever captured, and how the latest attempt went.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SessionChanges {
    /// The latest capture, if any succeeded.
    pub changeset: Option<Changeset>,
    /// The latest attempt, if any was made.
    pub attempt: Option<CaptureAttempt>,
}

#[cfg(test)]
mod test;
