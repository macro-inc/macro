//! Bounded workspace capture using the pinned diffd engine and git adapter.
#![deny(missing_docs)]

mod build;
pub mod domain;
mod outbound;
pub use build::build;

use domain::ports::RepoSource;
use serde::{Deserialize, Serialize};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
};

/// A repository-relative comparison; the runtime root is never agent-controlled.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Comparison {
    /// Base commit or branch; HEAD when omitted.
    pub base: Option<String>,
    /// Optional tip commit; absent means the worktree.
    pub head: Option<String>,
}

/// One structural capture uploaded to the review service.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capture {
    /// Pinned comparison returned by git.
    pub comparison: Comparison,
    /// Repository name.
    pub repository: String,
    /// Runtime captures include uncommitted edits.
    pub source: &'static str,
    /// Full contents, alignment, syntax, novelty, and symbols.
    pub snapshot: diffd_core::model::Snapshot,
}

/// Capture service bounded independently of the conversation process.
#[derive(Clone)]
pub struct WorkspaceCapture {
    root: PathBuf,
    gate: Arc<tokio::sync::Semaphore>,
    cache: Arc<std::sync::Mutex<build::CaptureCache>>,
}

impl WorkspaceCapture {
    /// Allow captures only inside this configured workspace root.
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            gate: Arc::new(tokio::sync::Semaphore::new(1)),
            cache: Arc::new(std::sync::Mutex::new(build::CaptureCache::default())),
        }
    }

    /// Capture a persisted session workspace without staging, checking out, or writing git.
    pub async fn capture(
        &self,
        workspace: PathBuf,
        comparison: Comparison,
    ) -> Result<Capture, String> {
        let permit = self
            .gate
            .clone()
            .try_acquire_owned()
            .map_err(|_| "A workspace capture is already running".to_owned())?;
        let root = self.root.clone();
        let cache = self.cache.clone();
        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            let mut cache = cache
                .lock()
                .map_err(|_| "Capture cache failed".to_owned())?;
            capture(&root, &workspace, &comparison, &mut cache)
                .map_err(|error| format!("{error:#}"))
        })
        .await
        .map_err(|_| "Workspace capture failed".to_owned())?
    }
}

fn capture(
    root: &Path,
    workspace: &Path,
    comparison: &Comparison,
    cache: &mut build::CaptureCache,
) -> anyhow::Result<Capture> {
    let root = root.canonicalize()?;
    let workspace = workspace.canonicalize()?;
    anyhow::ensure!(
        workspace.starts_with(&root),
        "Session workspace is outside the configured runtime root"
    );
    let git = outbound::git::GitCli;
    let repo = git.open(&workspace)?;
    anyhow::ensure!(
        repo.root.canonicalize()?.starts_with(&root),
        "Repository is outside the configured runtime root"
    );
    let resolved = git.resolve(
        &repo,
        comparison.base.as_deref().unwrap_or("HEAD"),
        comparison.head.as_deref(),
    )?;
    let inputs = git.changes(&repo, &resolved)?;
    anyhow::ensure!(
        inputs.len() <= 10_000,
        "Comparison contains more than 10,000 files"
    );
    let snapshot = build::build_cached(inputs, cache).map_err(anyhow::Error::msg)?;
    Ok(Capture {
        comparison: Comparison {
            base: Some(resolved.base),
            head: resolved.to,
        },
        repository: repo.name,
        source: "workspace",
        snapshot,
    })
}

#[cfg(test)]
mod test;
