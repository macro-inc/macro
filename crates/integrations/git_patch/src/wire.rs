//! The changeset summary on the wire, shared by every route that serves one so
//! clients decode a single shape.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::model::{ChangedFile, FileChangeKind, GitRef};

/// What happened to a file, on the wire.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum FileChangeKindDto {
    /// The file did not exist before.
    Added,
    /// The file exists on both sides with different contents.
    Modified,
    /// The file no longer exists.
    Deleted,
    /// The file moved; `previousPath` says from where.
    Renamed,
}

impl From<FileChangeKind> for FileChangeKindDto {
    fn from(kind: FileChangeKind) -> Self {
        match kind {
            FileChangeKind::Added => Self::Added,
            FileChangeKind::Modified => Self::Modified,
            FileChangeKind::Deleted => Self::Deleted,
            FileChangeKind::Renamed => Self::Renamed,
        }
    }
}

/// The source of a changeset's diff, on the wire.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum ChangesetSourceDto {
    /// The diff of a GitHub pull request.
    GithubPullRequest,
}

/// One changed file.
///
/// Clients deserialize this, so both derives are used.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct ChangedFileDto {
    /// The file's path after the change, or before it for a deletion.
    pub path: String,
    /// Where a renamed file came from.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub previous_path: Option<String>,
    /// What happened to the file.
    pub kind: FileChangeKindDto,
    /// Lines added.
    pub additions: u32,
    /// Lines removed.
    pub deletions: u32,
    /// The diff carries no text for this file.
    pub binary: bool,
    /// The file's hunks were left out of the patch to fit the size budget.
    pub patch_omitted: bool,
}

impl From<ChangedFile> for ChangedFileDto {
    fn from(file: ChangedFile) -> Self {
        Self {
            path: file.path,
            previous_path: file.previous_path,
            kind: file.kind.into(),
            additions: file.additions,
            deletions: file.deletions,
            binary: file.binary,
            patch_omitted: file.patch_omitted,
        }
    }
}

/// One end of the compared range.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct GitRefDto {
    /// The branch name, when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// The commit, when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha: Option<String>,
}

impl From<GitRef> for GitRefDto {
    fn from(git_ref: GitRef) -> Self {
        Self {
            name: git_ref.name,
            sha: git_ref.sha,
        }
    }
}

/// One changeset: the files a patch touches and what happened to each.
///
/// Clients deserialize this, so both derives are used.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct ChangesetDto {
    /// The changeset's id; a different id means different changes.
    pub id: Uuid,
    /// Where the diff was read from.
    pub source: ChangesetSourceDto,
    /// `https://github.com/owner/name`, when known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repository: Option<String>,
    /// The side the work started from.
    pub base: GitRefDto,
    /// The side carrying the work.
    pub head: GitRefDto,
    /// Every changed file, in patch order.
    pub files: Vec<ChangedFileDto>,
    /// Lines added across all files.
    pub additions: u32,
    /// Lines removed across all files.
    pub deletions: u32,
    /// Size of the patch the matching patch route serves; zero when nothing
    /// changed.
    pub patch_bytes: u64,
    /// Some files' hunks were left out of the patch.
    pub truncated: bool,
    /// When the diff was taken.
    pub captured_at: DateTime<Utc>,
}
