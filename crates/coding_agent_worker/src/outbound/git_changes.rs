//! Diffing the workspace for the host's Changes pane.
//!
//! The daemon's workspace is the only copy of the agent's work, so when the
//! host asks what changed this is answered here, with git: everything the
//! working tree has that the default branch does not - commits since the
//! merge base, staged and unstaged edits, and untracked files - as one
//! git-style patch. Nothing here writes to the repository.

use std::path::{Path, PathBuf};
use std::time::Duration;

use agent_runtime_protocol::domain::connection::ChangesCollector;
use agent_runtime_protocol::domain::schema::v0::{ChangesRef, CollectChangesResult};
use tokio::process::Command;

#[cfg(test)]
mod test;

/// Each git command gets this long; a diff of a huge tree is the slow one.
const COMMAND_TIMEOUT: Duration = Duration::from_secs(30);

/// The most patch text sent back. Past this the patch is cut at the last
/// whole file that fits and marked truncated, so the host never receives
/// half a file.
const MAX_PATCH_BYTES: usize = 6 * 1024 * 1024;

/// Branches tried, in order, when the remote does not say which is default.
const FALLBACK_DEFAULT_BRANCHES: &[&str] = &["main", "master"];

/// [`ChangesCollector`] over the daemon's workspace.
#[derive(Debug, Clone)]
pub struct WorkspaceChanges {
    workspace: PathBuf,
}

impl WorkspaceChanges {
    /// Collect from the repository at `workspace`.
    #[must_use]
    pub fn new(workspace: &Path) -> Self {
        Self {
            workspace: workspace.to_owned(),
        }
    }
}

impl ChangesCollector for WorkspaceChanges {
    async fn collect(&self) -> CollectChangesResult {
        match collect_workspace_changes(&self.workspace).await {
            Ok(result) => result,
            Err(error) => {
                tracing::warn!(error = ?error, "collecting workspace changes failed");
                CollectChangesResult::Error {
                    message: error.message,
                }
            }
        }
    }
}

/// A failure with a message safe to show the person at the other end.
#[derive(Debug)]
struct CollectError {
    message: String,
}

impl CollectError {
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

async fn collect_workspace_changes(workspace: &Path) -> Result<CollectChangesResult, CollectError> {
    let git = Git { workspace };
    if git.run(&["rev-parse", "--show-toplevel"]).await.is_err() {
        return Err(CollectError::new(
            "The harness workspace is not a git repository, so there are no changes to show.",
        ));
    }

    let head_sha = git.run(&["rev-parse", "HEAD"]).await.ok();
    let head_name = git
        .run(&["rev-parse", "--abbrev-ref", "HEAD"])
        .await
        .ok()
        .filter(|name| name != "HEAD");
    let repository = git.run(&["remote", "get-url", "origin"]).await.ok();

    let (base_name, base_sha) = match head_sha.as_deref() {
        Some(_) => base_of(&git).await,
        // A repository with no commits at all: everything is untracked, and
        // there is nothing to diff against.
        None => (None, None),
    };

    let mut patch = String::new();
    if let Some(base) = base_sha.as_deref() {
        // Commit-to-working-tree: every committed, staged, and unstaged
        // change since the base, in one diff.
        patch.push_str(
            &git.run_diff(&[
                "diff",
                "--no-color",
                "--no-ext-diff",
                "--find-renames",
                base,
                "--",
            ])
            .await?,
        );
    } else if head_sha.is_some() {
        patch.push_str(
            &git.run_diff(&[
                "diff",
                "--no-color",
                "--no-ext-diff",
                "--find-renames",
                "HEAD",
                "--",
            ])
            .await?,
        );
    }

    let untracked = git
        .run(&["ls-files", "--others", "--exclude-standard", "-z"])
        .await
        .unwrap_or_default();
    for path in untracked.split('\0').filter(|path| !path.is_empty()) {
        // `--no-index` against /dev/null renders an untracked file as an
        // addition; it exits 1 when there is a difference, which is the
        // point, so a non-zero exit is not a failure here.
        let addition = git
            .run_diff(&[
                "diff",
                "--no-color",
                "--no-ext-diff",
                "--no-index",
                "--",
                "/dev/null",
                path,
            ])
            .await?;
        patch.push_str(&addition);
    }

    let (patch, truncated) = truncate_at_file_boundary(patch, MAX_PATCH_BYTES);
    Ok(CollectChangesResult::Collected {
        patch,
        repository,
        base: ChangesRef {
            name: base_name,
            sha: base_sha,
        },
        head: ChangesRef {
            name: head_name,
            sha: head_sha,
        },
        truncated,
    })
}

/// The branch the work started from and the commit it diverged at.
///
/// The remote's default branch when the remote says (`origin/HEAD`), else
/// the first of `main`/`master` that exists on the remote; the base is the
/// merge base of HEAD and that branch. A workspace with no remote branch to
/// compare against diffs against its own HEAD, so uncommitted work still
/// shows.
async fn base_of(git: &Git<'_>) -> (Option<String>, Option<String>) {
    let mut candidates: Vec<String> = Vec::new();
    if let Ok(symbolic) = git
        .run(&[
            "symbolic-ref",
            "--quiet",
            "--short",
            "refs/remotes/origin/HEAD",
        ])
        .await
        && !symbolic.is_empty()
    {
        candidates.push(symbolic);
    }
    for fallback in FALLBACK_DEFAULT_BRANCHES {
        candidates.push(format!("origin/{fallback}"));
    }
    for fallback in FALLBACK_DEFAULT_BRANCHES {
        candidates.push((*fallback).to_owned());
    }
    for candidate in candidates {
        if git
            .run(&[
                "rev-parse",
                "--verify",
                "--quiet",
                &format!("{candidate}^{{commit}}"),
            ])
            .await
            .is_err()
        {
            continue;
        }
        if let Ok(merge_base) = git.run(&["merge-base", "HEAD", &candidate]).await {
            let name = candidate
                .strip_prefix("origin/")
                .unwrap_or(&candidate)
                .to_owned();
            return (Some(name), Some(merge_base));
        }
    }
    let head = git.run(&["rev-parse", "HEAD"]).await.ok();
    (None, head)
}

/// Cut `patch` at the last `diff --git` boundary within `limit` bytes.
fn truncate_at_file_boundary(patch: String, limit: usize) -> (String, bool) {
    if patch.len() <= limit {
        return (patch, false);
    }
    // A file fits when the boundary that follows it lies within the limit;
    // the marker itself may straddle the limit, so scan the whole patch.
    let cut = patch
        .match_indices("\ndiff --git ")
        .map(|(index, _)| index + 1)
        .filter(|&start| start <= limit)
        .last()
        .unwrap_or(0);
    (patch[..cut].to_owned(), true)
}

struct Git<'a> {
    workspace: &'a Path,
}

impl Git<'_> {
    /// Run git and return its trimmed stdout; any non-zero exit is an error.
    async fn run(&self, args: &[&str]) -> Result<String, CollectError> {
        let output = self.output(args).await?;
        if !output.status.success() {
            return Err(CollectError::new(format!(
                "git {} failed: {}",
                args.first().copied().unwrap_or(""),
                String::from_utf8_lossy(&output.stderr).trim()
            )));
        }
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
    }

    /// Run a `git diff`, whose exit code 1 means "there are differences".
    async fn run_diff(&self, args: &[&str]) -> Result<String, CollectError> {
        let output = self.output(args).await?;
        match output.status.code() {
            Some(0 | 1) => Ok(String::from_utf8_lossy(&output.stdout).into_owned()),
            _ => Err(CollectError::new(format!(
                "git diff failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            ))),
        }
    }

    async fn output(&self, args: &[&str]) -> Result<std::process::Output, CollectError> {
        let command = Command::new("git")
            .args(args)
            .current_dir(self.workspace)
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_OPTIONAL_LOCKS", "0")
            .kill_on_drop(true)
            .output();
        match tokio::time::timeout(COMMAND_TIMEOUT, command).await {
            Ok(Ok(output)) => Ok(output),
            Ok(Err(error)) if error.kind() == std::io::ErrorKind::NotFound => Err(
                CollectError::new("git is not installed on the harness machine."),
            ),
            Ok(Err(error)) => Err(CollectError::new(format!("could not run git: {error}"))),
            Err(_) => Err(CollectError::new(
                "git took too long to diff the workspace.",
            )),
        }
    }
}
