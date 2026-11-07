#![deny(missing_docs)]
//! Reading git-style unified diffs into per-file facts, cutting them down to a
//! size budget, and the changeset summary types built from them.
//!
//! Agent session changes and GitHub pull request changes both read patches
//! through this crate, so a file's status and line counts, and the summary a
//! client decodes, are the same whichever produced the patch.

pub mod model;
pub mod patch;
pub mod wire;

pub use model::{ChangedFile, ChangesetRange, FileChangeKind, GitRef};
pub use patch::{
    BudgetedPatch, MAX_FILE_PATCH_BYTES, MAX_PATCH_BYTES, ParsedFile, budget_patch,
    parse_git_patch, totals,
};
