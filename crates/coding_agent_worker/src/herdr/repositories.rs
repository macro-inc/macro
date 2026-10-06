//! Session workspaces: the repository store refreshes Git; Herdr owns worktrees.

use super::cli::HerdrCli;
use crate::outbound::git::{GitRepositories, git, primary_worktree};
use crate::repository::{Repository, prepare};
use std::path::{Path, PathBuf};

/// Serializes repository preparation within one macrod instance.
pub(crate) struct Workspaces {
    git: GitRepositories,
    herdr: HerdrCli,
    root: PathBuf,
    preparing: tokio::sync::Mutex<()>,
}

impl Workspaces {
    pub(crate) fn new(search: PathBuf, root: PathBuf, herdr: HerdrCli) -> Self {
        Self {
            git: GitRepositories {
                search,
                cache: root.join("repos"),
            },
            herdr,
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
        let source = primary_worktree(&clone).await?;
        std::fs::create_dir_all(path.parent().unwrap_or(Path::new(".")))?;
        self.herdr
            .create_worktree(&source, &path, &format!("macro/{session}"))
            .await?;
        Ok(path)
    }
}
