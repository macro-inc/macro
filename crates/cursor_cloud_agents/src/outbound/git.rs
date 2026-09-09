//! Choosing a standalone agent's repository from its checkout.

use crate::domain::model::RepoUrl;
use crate::domain::ports::{RepositoryChooser, SessionIntent};
use std::path::Path;
use std::process::Command;

/// Every session works on the repository the process was started in - the
/// `origin` remote of the checkout the client is sitting in, which for an
/// editor-spawned agent is the project the user has open.
///
/// A configured override (`CURSOR_REPO`) wins over resolution, for clients
/// started somewhere other than the repository the agent should work in.
///
/// The prompt is not read: a standalone agent has no listing of the user's
/// repositories to choose between, and the checkout is a better answer than a
/// guess. Deciding from the prompt is the hosted harness's job.
#[derive(Debug)]
pub struct GitRepositoryChooser {
    repo: Option<RepoUrl>,
}

impl GitRepositoryChooser {
    /// Resolve the repository once, from `override_repo` or `cwd`'s origin.
    #[must_use]
    pub fn new(override_repo: Option<RepoUrl>, cwd: &Path) -> Self {
        let repo = override_repo.or_else(|| origin_remote(cwd));
        if repo.is_none() {
            tracing::warn!(
                cwd = %cwd.display(),
                "no repository resolved - these sessions will not appear in the Cursor sessions list"
            );
        }
        Self { repo }
    }
}

impl RepositoryChooser for GitRepositoryChooser {
    async fn choose(&self, _prompt: &str) -> Result<SessionIntent, rootcause::Report> {
        Ok(SessionIntent {
            repository: self.repo.clone(),
            open_pull_request: self.repo.is_some(),
        })
    }
}

/// The `origin` remote of the checkout at `cwd`, normalized.
fn origin_remote(cwd: &Path) -> Option<RepoUrl> {
    if cwd.as_os_str().is_empty() {
        return None;
    }
    // Synchronous by design: `git remote get-url` is a local metadata read,
    // and this runs once per process.
    let output = Command::new("git")
        .arg("-C")
        .arg(cwd)
        .args(["remote", "get-url", "origin"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    RepoUrl::parse(&String::from_utf8_lossy(&output.stdout))
}
