//! `cargo x nextest-filter <changed-files-path>`
//!
//! Computes the set of workspace packages cargo nextest / clippy should run
//! for Rust CI.
//!
//! Input is a newline-delimited file of paths relative to the repository root
//! (typically `git diff --name-only ...`). For each changed path inside the
//! Rust workspace, find the deepest workspace package containing that
//! path using Cargo's own workspace metadata via guppy. Shared files that
//! crates embed from outside their own directory are mapped through
//! [`EMBEDDED_ASSET_PACKAGES`]. The result is the changed packages plus every
//! workspace reverse dependency, so a leaf-crate PR compiles that crate (and
//! its dependents) instead of the whole workspace.
//!
//! Stdout is one of:
//! - `none` — no changed file mapped to a package (a top-level JSON, a Nix
//!   shell tweak, docs, …). CI must not treat this as "run everything".
//! - space-separated package names — pass each as `cargo nextest run -p` /
//!   `cargo clippy -p`.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};
use guppy::graph::{DependencyDirection, PackageGraph};
use xtask_graph::build_graph;

#[cfg(test)]
mod test;

/// Workspace paths that crates consume at compile time from outside their own
/// directory (`include_str!`/`include_bytes!` or `build.rs` reads), mapped to
/// the consuming packages. Directory containment cannot attribute these, so
/// without an entry here a change to such a file would select no tests
/// whenever the PR also touches a package. The drift test in `test.rs` keeps
/// this table in sync with the source tree, and every run validates the
/// package names against the workspace so a rename fails loudly.
const EMBEDDED_ASSET_PACKAGES: &[(&str, &[&str])] = &[(
    "static_assets",
    &[
        "cache-core",
        "complete_graph",
        "documents",
        "seed_cli",
        "xtask_workflows",
    ],
)];

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.iter().map(String::as_str).collect::<Vec<_>>()[..] {
        [changed_files_path] => {
            // Read-only: `--locked` so computing the filter never rewrites Cargo.lock.
            let graph = build_graph(true)?;
            run(&graph, Path::new(changed_files_path))
        }
        _ => bail!("usage: cargo x nextest-filter <changed-files-path>"),
    }
}

fn run(graph: &PackageGraph, changed_files_path: &Path) -> Result<()> {
    let changed_files = std::fs::read_to_string(changed_files_path).with_context(|| {
        format!(
            "reading changed files from {}",
            changed_files_path.display()
        )
    })?;

    let packages = compute_packages(graph, &changed_files)?;
    println!("{packages}");
    Ok(())
}

/// Map each changed path to its owning workspace package (or embedded-asset
/// consumers) and expand to reverse dependencies. Unmapped files contribute
/// nothing; if nothing maps, the result is the token none so CI skips tests
/// instead of falling back to the full suite.
fn compute_packages(graph: &PackageGraph, changed_files: &str) -> Result<String> {
    let changed = changed_workspace_packages(graph, changed_files)?;
    if changed.is_empty() {
        return Ok("none".to_owned());
    }
    let expanded = expand_rdeps(graph, &changed)?;
    Ok(expanded.into_iter().collect::<Vec<_>>().join(" "))
}

fn changed_workspace_packages(
    graph: &PackageGraph,
    changed_files: &str,
) -> Result<BTreeSet<String>> {
    let workspace = graph.workspace();
    let ws_root = workspace.root();
    let repo_root = ws_root;

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

    let package_names: BTreeSet<&str> = packages.iter().map(|(_, name)| name.as_str()).collect();
    for (prefix, names) in EMBEDDED_ASSET_PACKAGES {
        if let Some(name) = names.iter().find(|name| !package_names.contains(**name)) {
            bail!(
                "EMBEDDED_ASSET_PACKAGES maps `{prefix}` to `{name}`, which is not a \
                 workspace package; update the table in {}",
                file!()
            );
        }
    }

    let mut changed_packages = BTreeSet::new();
    for changed_file in changed_files.lines().filter(|line| !line.is_empty()) {
        for (prefix, names) in EMBEDDED_ASSET_PACKAGES {
            if Path::new(changed_file).starts_with(prefix) {
                changed_packages.extend(names.iter().map(|name| (*name).to_owned()));
            }
        }

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

    Ok(changed_packages)
}

fn expand_rdeps(graph: &PackageGraph, changed: &BTreeSet<String>) -> Result<BTreeSet<String>> {
    let mut ids = Vec::new();
    for name in changed {
        let pkg = graph
            .workspace()
            .member_by_name(name)
            .with_context(|| format!("workspace member `{name}` not found"))?;
        ids.push(pkg.id().clone());
    }
    let set = graph.query_reverse(ids.iter())?.resolve();
    Ok(set
        .packages(DependencyDirection::Reverse)
        .filter(|package| package.in_workspace())
        .map(|package| package.name().to_owned())
        .collect())
}
