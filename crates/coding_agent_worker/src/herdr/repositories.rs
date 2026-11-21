//! Session workspaces: the repository store refreshes Git, and each session
//! gets a plain `git worktree` of it. Not a herdr worktree: herdr 0.9 groups
//! those under the operator's repository workspace, and each session opens
//! in its own workspace instead.

use crate::outbound::git::{GitRepositories, git};
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
        git(
            &clone,
            &[
                "worktree",
                "add",
                "-b",
                &format!("macro/{session}"),
                &path.to_string_lossy(),
                "origin/main",
            ],
        )
        .await?;
        Ok(path)
    }
}
