//! Computes the cargo-nextest package filter for cloud-storage CI.
//!
//! Input is a newline-delimited file of paths relative to the repository root
//! (typically `git diff --name-only ...`). For each changed path inside the
//! cloud-storage workspace, find the deepest workspace package containing that
//! path using Cargo's own workspace metadata via guppy. The resulting nextest
//! expression runs tests for reverse dependencies of every changed package.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use guppy::graph::PackageGraph;

pub fn run(graph: &PackageGraph, changed_files_path: &Path) -> Result<()> {
    let workspace = graph.workspace();
    let ws_root = workspace.root();
    let repo_root = ws_root
        .ancestors()
        .nth(2)
        .with_context(|| format!("no repo root two levels above {ws_root}"))?;

    let packages = workspace
        .iter()
        .map(|package| {
            let dir = package
                .manifest_path()
                .parent()
                .with_context(|| format!("manifest {} has no parent", package.manifest_path()))?;
            Ok((PathBuf::from(dir.as_std_path()), package.name().to_owned()))
        })
        .collect::<Result<Vec<_>>>()?;

    let changed_files = std::fs::read_to_string(changed_files_path).with_context(|| {
        format!(
            "reading changed files from {}",
            changed_files_path.display()
        )
    })?;

    let mut changed_packages = BTreeSet::new();
    for changed_file in changed_files.lines().filter(|line| !line.is_empty()) {
        let path = repo_root
            .join(changed_file)
            .canonicalize()
            .unwrap_or_else(|_| repo_root.join(changed_file).into());
        if path != ws_root.as_std_path() && !path.starts_with(ws_root.as_std_path()) {
            continue;
        }

        let package = packages
            .iter()
            .filter(|(dir, _)| path == *dir || path.starts_with(dir))
            .max_by_key(|(dir, _)| dir.components().count())
            .map(|(_, name)| name);

        if let Some(name) = package {
            changed_packages.insert(name.clone());
        }
    }

    let filter = changed_packages
        .into_iter()
        .map(|name| format!("rdeps(={})", escape_nextest_name(&name)))
        .collect::<Vec<_>>()
        .join("|");

    println!("{filter}");
    Ok(())
}

fn escape_nextest_name(name: &str) -> String {
    name.replace('\\', "\\\\")
        .replace(')', "\\)")
        .replace(',', "\\,")
}
