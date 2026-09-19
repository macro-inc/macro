#![deny(missing_docs)]
//! Shared guppy [`PackageGraph`] construction for the graph-based xtask
//! commands (`deps`, `nextest-filter`, `doppler-bins`).
//!
//! Anchors `cargo metadata` on the workspace root (from [`xtask_paths`]) so
//! the task works from anywhere in the repo.

use anyhow::{Context, Result};
use guppy::MetadataCommand;
use guppy::graph::PackageGraph;
use std::path::Path;

/// Build the workspace [`PackageGraph`] via `cargo metadata`.
///
/// When `locked` is set, `--locked` is passed so a stale `Cargo.lock` surfaces
/// as an error (it is itself drift for the generator) instead of being
/// silently rewritten.
pub fn build_graph(locked: bool) -> Result<PackageGraph> {
    let workspace_dir = xtask_paths::workspace_root();
    build_graph_at(&workspace_dir, locked)
}

/// Build a [`PackageGraph`] for the workspace rooted at `workspace_dir`.
pub fn build_graph_at(workspace_dir: &Path, locked: bool) -> Result<PackageGraph> {
    let mut cmd = MetadataCommand::new();
    cmd.current_dir(workspace_dir);
    if locked {
        cmd.other_options(vec!["--locked".to_owned()]);
    }
    cmd.build_graph().with_context(|| {
        if locked {
            "running cargo metadata --locked (a stale Cargo.lock is drift: run `just hakari` and commit)"
        } else {
            "running cargo metadata"
        }
    })
}
