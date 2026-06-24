//! Computes which "doppler config" validation binaries are affected by a set of
//! changed files, for cloud-storage CI.
//!
//! A handful of services ship a `doppler_config` binary — a `[[bin]]` whose
//! source is `src/doppler_config.rs` — that loads the service's `Config` from
//! Doppler for both the dev and prod environments. It is a config-contract
//! check: if the code expects a field Doppler doesn't have, the binary fails.
//! CI only needs to run it for a service when that service's config could have
//! changed, i.e. when its `src/config.rs`, `src/doppler_config.rs`, or
//! `Cargo.toml` changed.
//!
//! Input is a newline-delimited file of paths relative to the repository root
//! (typically `git diff --name-only ...`). Output is the affected bin names, one
//! per line, sorted and deduplicated. This is the native replacement for the
//! previous bash + python script and reuses the same guppy package graph as
//! [`crate::nextest_filter`].

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use guppy::graph::{BuildTargetId, PackageGraph};

/// Source path (relative to a crate root) of a service's doppler-config binary.
const DOPPLER_CONFIG_SRC: &str = "src/doppler_config.rs";

pub fn run(graph: &PackageGraph, changed_files_path: &Path) -> Result<()> {
    let workspace = graph.workspace();
    let ws_root = workspace.root();
    let repo_root = ws_root
        .ancestors()
        .nth(2)
        .with_context(|| format!("no repo root two levels above {ws_root}"))?;

    let changed_files = std::fs::read_to_string(changed_files_path).with_context(|| {
        format!(
            "reading changed files from {}",
            changed_files_path.display()
        )
    })?;
    let changed: BTreeSet<PathBuf> = changed_files
        .lines()
        .filter(|line| !line.is_empty())
        .map(|line| repo_root.join(line).into_std_path_buf())
        .collect();

    let mut bins = BTreeSet::new();
    for package in workspace.iter() {
        // Only services that actually ship a `src/doppler_config.rs` binary.
        let Some(bin_name) = package
            .build_targets()
            .find_map(|target| match target.id() {
                BuildTargetId::Binary(name) if target.path().ends_with(DOPPLER_CONFIG_SRC) => {
                    Some(name)
                }
                _ => None,
            })
        else {
            continue;
        };

        let dir = package
            .manifest_path()
            .parent()
            .with_context(|| format!("manifest {} has no parent", package.manifest_path()))?;

        // Re-validate when the config schema, the validator, or the manifest changes.
        let triggers = [
            dir.join("src/config.rs").into_std_path_buf(),
            dir.join(DOPPLER_CONFIG_SRC).into_std_path_buf(),
            dir.join("Cargo.toml").into_std_path_buf(),
        ];
        if triggers.iter().any(|trigger| changed.contains(trigger)) {
            bins.insert(bin_name.to_owned());
        }
    }

    for bin in bins {
        println!("{bin}");
    }
    Ok(())
}
