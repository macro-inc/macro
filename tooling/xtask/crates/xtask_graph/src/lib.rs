#![deny(missing_docs)]
//! Shared guppy [`PackageGraph`] construction for the graph-based xtask
//! commands (`deps`, `nextest-filter`, `doppler-bins`).
//!
//! Anchors `cargo metadata` on the workspace root (from [`xtask_paths`]) so
//! the task works from anywhere in the repo.

use anyhow::{Context, Result};
use guppy::graph::PackageGraph;
use guppy::{CargoMetadata, MetadataCommand};
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

/// [`build_graph_at`] with `--locked`, reusing the `cargo metadata` output saved at
/// `metadata_file`, or saving it there when that file is missing or unreadable.
///
/// The caller owns the file's identity: it must only name a file produced from the
/// same manifests, lockfile and workspace path.
pub fn build_graph_with_saved_metadata(
    workspace_dir: &Path,
    metadata_file: &Path,
) -> Result<PackageGraph> {
    if let Ok(json) = std::fs::read_to_string(metadata_file)
        && let Ok(graph) = CargoMetadata::parse_json(&json).and_then(CargoMetadata::build_graph)
    {
        return Ok(graph);
    }
    let mut cmd = MetadataCommand::new();
    cmd.current_dir(workspace_dir);
    cmd.other_options(vec!["--locked".to_owned()]);
    let metadata = cmd.exec().context("running cargo metadata --locked")?;
    let mut json = Vec::new();
    metadata
        .serialize(&mut json)
        .context("serializing cargo metadata")?;
    std::fs::write(metadata_file, json)
        .with_context(|| format!("saving cargo metadata to {}", metadata_file.display()))?;
    metadata.build_graph().context("building the package graph")
}
