//! Reading a git-style unified diff into per-file facts, shared through
//! [`git_patch`] with the GitHub pull request changes.

pub use git_patch::patch::{
    BudgetedPatch, MAX_FILE_PATCH_BYTES, MAX_PATCH_BYTES, ParsedFile, budget_patch,
    parse_git_patch, totals,
};
