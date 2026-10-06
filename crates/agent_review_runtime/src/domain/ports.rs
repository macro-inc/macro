// Adapted from 404Wolf/diffd 91a5e3e7719d717c2cd1b6238e146023e8afb1df.
// Copyright (c) 2026 Wolf Mermelstein. MIT; see ../../LICENSE.
//! Repository ports adapted from the upstream git reader.

use std::path::{Path, PathBuf};

use diffd_core::build::FileInput;
use diffd_core::difft::EngineDiff;

/// A repository the agent pointed us at.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Repo {
    /// Canonical git root.
    pub root: PathBuf,
    /// Display name.
    pub name: String,
}

/// Two resolved revisions: `base` is a commit, `to` is a commit or the working tree.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Resolved {
    /// Immutable base commit.
    pub base: String,
    /// Immutable tip, or the working tree.
    pub to: Option<String>,
}

/// Reads repositories.
pub trait RepoSource: Send + Sync {
    /// Resolve the repository containing a workspace.
    fn open(&self, path: &Path) -> anyhow::Result<Repo>;
    /// Resolve immutable sides, using the merge base for named branches.
    fn resolve(&self, repo: &Repo, from: &str, to: Option<&str>) -> anyhow::Result<Resolved>;
    /// Every changed file between the two sides, with full contents.
    fn changes(&self, repo: &Repo, resolved: &Resolved) -> anyhow::Result<Vec<FileInput>>;
}

/// Files larger than this are listed but never read.
pub const MAX_FILE_BYTES: u64 = 8 * 1024 * 1024;

/// A file's contents, unless it's over [`MAX_FILE_BYTES`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Contents {
    /// Original bytes, including non-UTF-8 files.
    Bytes(Vec<u8>),
    /// Metadata indicates that the configured budget would be exceeded.
    TooLarge,
}

/// A structural diff engine (difftastic). Returns `None` when it can't help,
/// and the caller falls back to a line diff.
pub trait DiffEngine: Send + Sync {
    /// Compute structural alignment, or ask the caller to use line fallback.
    fn diff(&self, path: &str, old: &str, new: &str) -> Option<EngineDiff>;
}
