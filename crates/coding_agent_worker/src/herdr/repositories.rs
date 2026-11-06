//! Session workspaces: the repository store refreshes Git; herdr (git itself under herdr-core) creates worktrees.

use super::cli::HerdrCli;
use crate::outbound::git::{GitRepositories, git, primary_worktree};
use crate::repository::{Repository, prepare};
use std::path::{Path, PathBuf};

/// Serializes repository preparation within one macrod instance.
pub(crate) struct Workspaces {
    herdr: HerdrCli,
    root: PathBuf,
    preparing: tokio::sync::Mutex<()>,
}

impl Workspaces {
    pub(crate) fn new(root: PathBuf, herdr: HerdrCli) -> Self {
        Self {
            herdr,
            root,
            preparing: tokio::sync::Mutex::new(()),
        }
    }

    /// The session's worktree, from a clone found under `search` (the
    /// session's workspace) or cloned into the private cache.
    pub(crate) async fn prepare(
        &self,
        search: &Path,
        session: &str,
        url: &str,
    ) -> rootcause::Result<PathBuf> {
        let repository = Repository::parse(url)?;
        let repositories = GitRepositories {
            search: search.to_owned(),
            cache: self.root.join("repos"),
        };
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
        let clone = prepare(&repositories, &repository).await?;
        let source = primary_worktree(&clone).await?;
        std::fs::create_dir_all(path.parent().unwrap_or(Path::new(".")))?;
        self.herdr
            .create_worktree(&source, &path, &format!("macro/{session}"))
            .await?;
        Ok(path)
    }
}
