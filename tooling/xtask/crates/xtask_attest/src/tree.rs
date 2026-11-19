//! The tree a pass is recorded for, and what a branch changed.
//!
//! A git tree's id is git's own hash of every file in a commit, so two
//! commits name the same tree exactly when they hold the same files. A pass
//! is recorded for the tree it ran on, and `PR CI` accepts it for the merge
//! commit that names the same one.

use std::path::Path;

use rootcause::prelude::*;

use crate::git::{git, in_repository};

#[cfg(test)]
mod test;

/// Any path, as a trigger.
const ANY_PATH: &str = ".";

/// The tree of a commit.
pub fn tree_of(dir: &Path, commit: &str) -> Result<String, Report> {
    git(dir, &["rev-parse", &format!("{commit}^{{tree}}")])
}

/// What git reports as changed or untracked in the working tree. A pass is
/// recorded for a commit's files, so these must be committed first.
pub fn uncommitted(dir: &Path) -> Result<Vec<String>, Report> {
    Ok(
        git(dir, &["status", "--porcelain", "--untracked-files=all"])?
            .lines()
            .map(|line| line.trim().to_owned())
            .collect(),
    )
}

/// Whether two commits differ under any of `paths`.
pub fn differs_under(dir: &Path, from: &str, to: &str, paths: &[String]) -> Result<bool, Report> {
    let mut command = in_repository("git", dir);
    command.args(["diff", "--quiet", from, to, "--"]);
    if !paths.iter().any(|path| path == ANY_PATH) {
        command.args(paths);
    }
    let status = command.status().context("could not run git diff")?;
    match status.code() {
        Some(0) => Ok(false),
        Some(1) => Ok(true),
        _ => bail!("git diff {from} {to} failed"),
    }
}

/// The commits before `commit`, following first parents, that hold the same
/// tree: a reworded or empty commit. What was said about their files was
/// said about these.
pub fn same_tree_before(dir: &Path, commit: &str, limit: usize) -> Result<Vec<String>, Report> {
    let tree = tree_of(dir, commit)?;
    let listed = git(
        dir,
        &[
            "rev-list",
            "--first-parent",
            &format!("--max-count={}", limit + 1),
            commit,
        ],
    )?;

    let mut same = Vec::new();
    for earlier in listed.lines().skip(1) {
        if tree_of(dir, earlier)? != tree {
            break;
        }
        same.push(earlier.to_owned());
    }
    Ok(same)
}
