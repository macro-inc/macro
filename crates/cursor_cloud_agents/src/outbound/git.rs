//! Resolving a session's repository from its working directory.

use crate::domain::model::RepoUrl;
use crate::domain::ports::RepoResolver;
use std::path::Path;
use std::process::Command;

/// Resolves the repository from the `origin` remote of the checkout the
/// client is working in — Zed sends the open project directory as the
/// session's `cwd`, whose origin is almost always the repo the user means.
///
/// A configured override (`CURSOR_REPO`) wins over resolution, for clients
/// whose `cwd` is not a checkout of the repo the agent should work in.
#[derive(Debug, Default)]
pub struct GitRepoResolver {
    /// When set, every session uses this repository.
    pub override_repo: Option<RepoUrl>,
}

impl RepoResolver for GitRepoResolver {
    fn resolve(&self, cwd: &Path) -> Option<RepoUrl> {
        if let Some(repo) = &self.override_repo {
            return Some(repo.clone());
        }
        if cwd.as_os_str().is_empty() {
            return None;
        }
        // Synchronous by design: `git remote get-url` is a local metadata
        // read, and this runs once per session/new.
        let output = Command::new("git")
            .args(["-C"])
            .arg(cwd)
            .args(["remote", "get-url", "origin"])
            .output()
            .ok()?;
        if !output.status.success() {
            return None;
        }
        RepoUrl::parse(&String::from_utf8_lossy(&output.stdout))
    }
}
