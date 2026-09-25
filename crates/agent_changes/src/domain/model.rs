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

/// What happened to one file, as a diff reports it.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, strum::Display, strum::EnumString,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum FileChangeKind {
    /// The file did not exist before.
    Added,
    /// The file exists on both sides with different contents.
    Modified,
    /// The file no longer exists.
    Deleted,
    /// The file moved; `previous_path` names where from. Contents may also
    /// have changed.
    Renamed,
}

/// One file in a changeset, as much as the pane's tree and headers need.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFile {
    /// The file's path after the change - or before it, for a deletion.
    pub path: String,
    /// Where a renamed file came from.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub previous_path: Option<String>,
    /// What happened to the file.
    pub kind: FileChangeKind,
    /// Lines added.
    pub additions: u32,
    /// Lines removed.
    pub deletions: u32,
    /// The diff carries no text for this file (an image, an archive, ...).
    #[serde(default)]
    pub binary: bool,
    /// This file's hunks were left out of the stored patch because the
    /// changeset exceeded the size budget; the summary is still complete.
    #[serde(default)]
    pub patch_omitted: bool,
}

/// One end of the compared range, as much of it as the provider told us.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRef {
    /// The branch name, when the provider names one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// The commit the diff was taken at, when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha: Option<String>,
}

impl GitRef {
    /// A ref known by name only.
    #[must_use]
    pub fn named(name: impl Into<String>) -> Self {
        Self {
            name: Some(name.into()),
            sha: None,
        }
    }
}

/// What was compared with what.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangesetRange {
    /// The linked pull request's repository, as `https://github.com/owner/name`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repository: Option<String>,
    /// The side the work started from.
    pub base: GitRef,
    /// The side carrying the work.
    pub head: GitRef,
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

/// An `owner/name` GitHub repository, parsed from any of the spellings a
/// provider uses (`https://github.com/o/n`, `github.com/o/n`, `o/n`, with or
/// without a trailing `.git`).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct RepositorySlug {
    /// The account the repository lives under.
    pub owner: String,
    /// The repository's name.
    pub name: String,
}

impl RepositorySlug {
    /// Parse a repository reference. `None` when the text does not name a
    /// GitHub repository.
    #[must_use]
    pub fn parse(text: &str) -> Option<Self> {
        let trimmed = text.trim().trim_end_matches('/');
        let without_scheme = trimmed
            .strip_prefix("https://")
            .or_else(|| trimmed.strip_prefix("http://"))
            .or_else(|| trimmed.strip_prefix("git@"))
            .unwrap_or(trimmed);
        let path = without_scheme
            .strip_prefix("github.com/")
            .or_else(|| without_scheme.strip_prefix("github.com:"))
            .unwrap_or(without_scheme);
        let path = path.strip_suffix(".git").unwrap_or(path);
        let mut parts = path.split('/');
        let owner = parts.next()?;
        let name = parts.next()?;
        if parts.next().is_some() || owner.is_empty() || name.is_empty() {
            return None;
        }
        let valid = |part: &str| {
            part.chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        };
        if !valid(owner) || !valid(name) {
            return None;
        }
        Some(Self {
            owner: owner.to_owned(),
            name: name.to_owned(),
        })
    }

    /// The canonical `https://github.com/{owner}/{name}` address.
    #[must_use]
    pub fn https_url(&self) -> String {
        format!("https://github.com/{}/{}", self.owner, self.name)
    }
}

impl std::fmt::Display for RepositorySlug {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{}/{}", self.owner, self.name)
    }
}

#[cfg(test)]
mod test;

/// A validated GitHub pull request URL, used to build a fixed-origin API request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PullRequestRef {
    /// The repository containing the PR, including when its head is a fork.
    pub repository: RepositorySlug,
    /// The positive GitHub pull request number.
    pub number: std::num::NonZeroU64,
}

impl PullRequestRef {
    /// Accept GitHub PR links, optionally with a files/commits suffix or fragment.
    pub fn parse(value: &str) -> Option<Self> {
        let url = url::Url::parse(value).ok()?;
        if url.scheme() != "https"
            || url.host_str() != Some("github.com")
            || !url.username().is_empty()
            || url.password().is_some()
            || url.port().is_some()
        {
            return None;
        }
        let mut segments = url.path_segments()?;
        let owner = segments.next()?;
        let repo = segments.next()?;
        if segments.next()? != "pull" {
            return None;
        }
        let number = segments.next()?.parse().ok()?;
        match segments.next() {
            None => {}
            Some("") if segments.next().is_none() => {}
            Some("files" | "commits" | "checks") if segments.next().is_none() => {}
            _ => return None,
        }
        Some(Self {
            repository: RepositorySlug::parse(&format!("{owner}/{repo}"))?,
            number,
        })
    }
}
