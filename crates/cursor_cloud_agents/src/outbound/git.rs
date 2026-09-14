//! Choosing a standalone agent's repository from its checkout.

use crate::domain::model::RepoUrl;
use crate::domain::ports::{RepositoryChooser, SessionIntent};
use std::path::Path;
use std::process::Command;

/// Resolves each standalone session's checkout, preserving the ACP `cwd`.
/// A configured `CURSOR_REPO` override takes precedence over its origin remote.
#[derive(Debug, Default)]
pub struct GitRepositoryChooser {
    /// Repository override for clients whose working directory is not a checkout.
    pub override_repo: Option<RepoUrl>,
}

impl RepositoryChooser for GitRepositoryChooser {
    async fn choose(&self, _prompt: &str, cwd: &Path) -> Result<SessionIntent, rootcause::Report> {
        let repo = self.override_repo.clone().or_else(|| origin_remote(cwd));
        Ok(SessionIntent {
            repository: repo,
            open_pull_request: false,
        })
    }
}

/// The `origin` remote of the checkout at `cwd`, normalized.
fn origin_remote(cwd: &Path) -> Option<RepoUrl> {
    if cwd.as_os_str().is_empty() {
        return None;
    }
    // Synchronous by design: `git remote get-url` is a local metadata read,
    // and this runs once when the session receives its first prompt.
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

#[cfg(test)]
mod test;
