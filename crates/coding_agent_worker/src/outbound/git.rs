//! Git-backed repository discovery and cache. Never checks out a user's branch.

use crate::repository::{Repository, RepositoryStore};

#[cfg(test)]
mod test;
use std::path::{Path, PathBuf};

/// Local clones beneath the configured directory and the daemon's private cache.
pub struct GitRepositories {
    /// Existing clone or directory containing clones (searched two levels deep).
    pub search: PathBuf,
    /// Private cache root.
    pub cache: PathBuf,
}

/// Run Git without a shell or an interactive credential prompt.
pub async fn git(path: &Path, args: &[&str]) -> rootcause::Result<String> {
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(120),
        tokio::process::Command::new("git")
            .arg("-C")
            .arg(path)
            .args(args)
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_SSH_COMMAND", "ssh -oBatchMode=yes")
            .stdin(std::process::Stdio::null())
            .kill_on_drop(true)
            .output(),
    )
    .await??;
    if !output.status.success() {
        rootcause::bail!(
            "git {} failed: {}",
            args.first().unwrap_or(&""),
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(String::from_utf8(output.stdout)?.trim().to_owned())
}

impl RepositoryStore for GitRepositories {
    async fn find(&self, repository: &Repository) -> rootcause::Result<Option<PathBuf>> {
        let mut candidates = vec![
            (self.search.clone(), 0),
            (self.cache.join(&repository.key), 2),
        ];
        while let Some((path, depth)) = candidates.pop() {
            if path.join(".git").exists() {
                if let Ok(remote) = git(&path, &["remote", "get-url", "origin"]).await
                    && Repository::parse(&remote).is_ok_and(|remote| remote.key == repository.key)
                {
                    return Ok(Some(path));
                }
                continue;
            }
            if depth >= 2 {
                continue;
            }
            if let Ok(entries) = std::fs::read_dir(&path) {
                for entry in entries.flatten() {
                    if entry.file_type().is_ok_and(|kind| kind.is_dir())
                        && !entry.file_name().to_string_lossy().starts_with('.')
                    {
                        candidates.push((entry.path(), depth + 1));
                    }
                }
            }
        }
        Ok(None)
    }

    async fn clone_repository(&self, repository: &Repository) -> rootcause::Result<PathBuf> {
        let target = self.cache.join(&repository.key);
        let parent = target
            .parent()
            .ok_or_else(|| rootcause::report!("invalid repository cache path"))?;
        std::fs::create_dir_all(parent)?;
        // A failed clone never makes a partial destination look reusable.
        let pending = parent.join(format!(".clone-{}", uuid::Uuid::new_v4()));
        let result = git(
            parent,
            &[
                "clone",
                "--no-checkout",
                "--",
                &repository.url,
                &pending.to_string_lossy(),
            ],
        )
        .await;
        if let Err(error) = result {
            let _ = std::fs::remove_dir_all(&pending);
            return Err(error);
        }
        std::fs::rename(&pending, &target)?;
        Ok(target)
    }

    async fn refresh_main(&self, path: &Path) -> rootcause::Result<()> {
        git(
            path,
            &[
                "fetch",
                "--no-tags",
                "origin",
                "+refs/heads/main:refs/remotes/origin/main",
            ],
        )
        .await?;
        Ok(())
    }
}

/// Find the repository's main checkout, which Herdr requires as the source of
/// a worktree-open action even when reopening an already managed worktree.
pub async fn primary_worktree(path: &Path) -> rootcause::Result<PathBuf> {
    let listing = git(path, &["worktree", "list", "--porcelain", "-z"]).await?;
    let source = listing
        .split('\0')
        .next()
        .and_then(|entry| entry.strip_prefix("worktree "))
        .filter(|path| !path.is_empty())
        .ok_or_else(|| rootcause::report!("git did not report the repository's main worktree"))?;
    Ok(PathBuf::from(source))
}
