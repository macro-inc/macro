//! Session workspaces: the repository store refreshes Git, and each session
//! gets a plain `git worktree` of it. Not a herdr worktree: herdr 0.9 groups
//! those under the operator's repository workspace, and each session opens
//! in its own workspace instead.

use crate::outbound::git::{GitRepositories, git};
use crate::repository::{Repository, RepositoryStore, prepare};
use std::path::{Path, PathBuf};

#[cfg(test)]
mod test;

/// Serializes repository preparation within one macrod instance.
pub(crate) struct Workspaces<Store = GitRepositories> {
    store: Store,
    root: PathBuf,
    preparing: tokio::sync::Mutex<()>,
}

impl Workspaces {
    pub(crate) fn new(search: PathBuf, root: PathBuf) -> Self {
        Self::with_store(
            GitRepositories {
                search,
                cache: root.join("repos"),
            },
            root,
        )
    }
}

impl<Store: RepositoryStore> Workspaces<Store> {
    fn with_store(store: Store, root: PathBuf) -> Self {
        Self {
            store,
            root,
            preparing: tokio::sync::Mutex::new(()),
        }
    }

    /// The session's worktree under `root/worktrees/<session>`. One that
    /// exists is returned as it is, on whatever branch its agent left it,
    /// without a fetch: only a new worktree fetches `origin/main` and starts
    /// from it.
    ///
    /// Its span records `outcome` and marks a failure, never the error's
    /// text: that can hold git output and local paths.
    #[tracing::instrument(
        name = "macrod.workspace.worktree",
        skip_all,
        fields(
            session_id = session,
            fetched = tracing::field::Empty,
            outcome = tracing::field::Empty,
            otel.status_code = tracing::field::Empty,
        ),
        err
    )]
    pub(crate) async fn prepare(&self, session: &str, url: &str) -> rootcause::Result<PathBuf> {
        let result = self.worktree(session, url).await;
        crate::trigger::record_outcome(
            &tracing::Span::current(),
            match &result {
                Ok(_) => crate::trigger::EventOutcome::Ok,
                Err(_) => crate::trigger::EventOutcome::Workspace,
            },
        );
        result
    }

    async fn worktree(&self, session: &str, url: &str) -> rootcause::Result<PathBuf> {
        let repository = Repository::parse(url)?;
        let _guard = self.preparing.lock().await;
        let path = self.root.join("worktrees").join(session);
        if path.exists() {
            let remote = git(&path, &["remote", "get-url", "origin"]).await?;
            if Repository::parse(&remote)?.key != repository.key {
                rootcause::bail!("the existing session worktree belongs to another repository");
            }
            // Redelivery and reconnect preserve the session's edits and base.
            tracing::Span::current().record("fetched", false);
            return Ok(path);
        }
        tracing::Span::current().record("fetched", true);
        let clone = prepare(&self.store, &repository).await?;
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
