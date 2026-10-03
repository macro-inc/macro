//! What a patch says about each file, and the range it compares.

use serde::{Deserialize, Serialize};

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

/// One file in a changeset, as much as a review's tree and headers need.
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
    /// The repository compared, as `https://github.com/owner/name`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repository: Option<String>,
    /// The side the work started from.
    pub base: GitRef,
    /// The side carrying the work.
    pub head: GitRef,
}
