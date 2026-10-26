//! Isolated session worktrees, opened separately as tabs in macrod's workspace.

use crate::outbound::git::{GitRepositories, create_worktree, git};
use crate::repository::{Repository, prepare};
use std::path::{Path, PathBuf};

/// Serializes repository preparation within one macrod instance.
pub(crate) struct Workspaces {
    git: GitRepositories,
    root: PathBuf,
    preparing: tokio::sync::Mutex<()>,
}

impl Workspaces {
    pub(crate) fn new(search: PathBuf, root: PathBuf) -> Self {
        Self {
            git: GitRepositories {
                search,
                cache: root.join("repos"),
            },
            root,
            preparing: tokio::sync::Mutex::new(()),
        }
    }

    pub(crate) async fn prepare(&self, session: &str, url: &str) -> rootcause::Result<PathBuf> {
        let repository = Repository::parse(url)?;
        let _guard = self.preparing.lock().await;
        let path = self.root.join("worktrees").join(session);
        if path.exists() {
            let remote = git(&path, &["remote", "get-url", "origin"]).await?;
            if Repository::parse(&remote)?.key != repository.key {
                rootcause::bail!("the existing session worktree belongs to another repository");
            }
            // Redelivery and reconnect preserve the session's edits and base.
            return Ok(path);
        }
        let clone = prepare(&self.git, &repository).await?;
        std::fs::create_dir_all(path.parent().unwrap_or(Path::new(".")))?;
        create_worktree(&clone, &path, &format!("macro/{session}")).await?;
        Ok(path)
    }
}
