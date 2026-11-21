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

/// How far back the reflog is read for commits `HEAD` was on before.
const REFLOG_ENTRIES: usize = 50;

/// Other commits that hold `commit`'s tree: the ones before it, following
/// first parents (an empty commit keeps its parent's files), and the ones
/// `HEAD` was on before it (an amended or reworded commit replaces one with
/// the same files). What was said about their files was said about these.
pub fn same_tree_elsewhere(dir: &Path, commit: &str, limit: usize) -> Result<Vec<String>, Report> {
    let tree = tree_of(dir, commit)?;
    let mut same = Vec::new();

    let parents = git(
        dir,
        &[
            "rev-list",
            "--first-parent",
            &format!("--max-count={}", limit + 1),
            commit,
        ],
    )?;
    for earlier in parents.lines().skip(1) {
        if tree_of(dir, earlier)? != tree {
            break;
        }
        same.push(earlier.to_owned());
    }

    // A working tree that has no reflog has no earlier commits to offer.
    let visited = git(
        dir,
        &[
            "reflog",
            "--format=%H",
            &format!("--max-count={REFLOG_ENTRIES}"),
        ],
    )
    .unwrap_or_default();
    // Up to `limit` of each kind: the parents must not crowd out the
    // commit an amend replaced.
    let mut replaced = Vec::new();
    for other in visited.lines() {
        let known = other == commit || same.iter().chain(&replaced).any(|seen| seen == other);
        if replaced.len() < limit
            && !known
            && tree_of(dir, other).is_ok_and(|other_tree| other_tree == tree)
        {
            replaced.push(other.to_owned());
        }
    }

    same.extend(replaced);
    Ok(same)
}
