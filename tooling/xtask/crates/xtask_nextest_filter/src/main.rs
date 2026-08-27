//! `cargo x nextest-filter <changed-files-path> <base-revision>`
//!
//! Computes the set of workspace packages cargo nextest / clippy should run
//! for Rust CI using [`determinator`].
//!
//! Input is a newline-delimited file of paths relative to the repository root
//! (typically `git diff --name-only ...`) and a Git base revision. The command
//! builds Cargo metadata for the base and current revisions, then lets
//! determinator account for path, dependency, and feature changes. Shared
//! inputs that Cargo does not know about are declared in `determinator.toml`.
//!
//! Stdout is one of:
//! - `all` — every workspace package is affected.
//! - `none` — no changed file mapped to a package (a top-level JSON, a Nix
//!   shell tweak, docs, …). CI must not treat this as "run everything".
//! - space-separated package names — pass each as `cargo nextest run -p` /
//!   `cargo clippy -p`.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use anyhow::{Context, Result, bail};
use determinator::Determinator;
use determinator::rules::{DeterminatorRules, PathMatch};
use guppy::graph::{DependencyDirection, PackageGraph};
use tempfile::TempDir;
#[cfg(test)]
use xtask_graph::build_graph;
use xtask_graph::build_graph_at;

#[cfg(test)]
mod test;

const DETERMINATOR_RULES: &str = include_str!("../determinator.toml");

fn main() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.iter().map(String::as_str).collect::<Vec<_>>()[..] {
        [changed_files_path, base_revision] => run(Path::new(changed_files_path), base_revision),
        _ => bail!("usage: cargo x nextest-filter <changed-files-path> <base-revision>"),
    }
}

fn run(changed_files_path: &Path, base_revision: &str) -> Result<()> {
    let changed_files = std::fs::read_to_string(changed_files_path).with_context(|| {
        format!(
            "reading changed files from {}",
            changed_files_path.display()
        )
    })?;

    let workspace_dir = xtask_paths::workspace_root();
    let base_worktree = BaseWorktree::new(&workspace_dir, base_revision)?;
    let (old_graph, new_graph) = build_graphs(base_worktree.path(), &workspace_dir)?;
    let packages = compute_packages(&old_graph, &new_graph, &changed_files)?;
    println!("{packages}");
    Ok(())
}

fn build_graphs(base_dir: &Path, current_dir: &Path) -> Result<(PackageGraph, PackageGraph)> {
    Ok((
        build_graph_at(base_dir, true)?,
        build_graph_at(current_dir, true)?,
    ))
}

/// Use determinator to compare both Cargo graphs and return affected package
/// names. Paths outside Cargo packages contribute nothing, preserving the CI
/// behavior for Nix-only and other non-Rust changes.
fn compute_packages(
    old_graph: &PackageGraph,
    new_graph: &PackageGraph,
    changed_files: &str,
) -> Result<String> {
    let rules = DeterminatorRules::parse(DETERMINATOR_RULES)
        .context("parsing nextest determinator rules")?;
    let mut determinator = Determinator::new(old_graph, new_graph);
    determinator
        .set_rules(&rules)
        .context("applying nextest determinator rules")?;

    for changed_file in changed_files.lines().filter(|line| !line.is_empty()) {
        if !matches!(
            determinator.match_path(changed_file, |_| {}),
            PathMatch::NoMatches
        ) {
            determinator.add_changed_paths([changed_file]);
        }
    }

    let affected = determinator.compute().affected_set;
    let packages: BTreeSet<_> = affected
        .packages(DependencyDirection::Forward)
        .filter(|package| package.in_workspace())
        .map(|package| package.name().to_owned())
        .collect();

    if packages.is_empty() {
        return Ok("none".to_owned());
    }

    if packages.len() == new_graph.workspace().iter().count() {
        return Ok("all".to_owned());
    }

    Ok(packages.into_iter().collect::<Vec<_>>().join(" "))
}

struct BaseWorktree {
    repo_root: PathBuf,
    path: PathBuf,
    _temp_dir: TempDir,
}

impl BaseWorktree {
    fn new(repo_root: &Path, revision: &str) -> Result<Self> {
        let temp_dir = tempfile::Builder::new()
            .prefix("nextest-determinator-")
            .tempdir()
            .context("creating temporary directory for base worktree")?;
        let path = temp_dir.path().join("base");
        let output = Command::new("git")
            .current_dir(repo_root)
            .args(["worktree", "add", "--detach"])
            .arg(&path)
            .arg(revision)
            .output()
            .context("creating base Git worktree")?;
        if !output.status.success() {
            bail!(
                "creating base Git worktree failed: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            );
        }

        Ok(Self {
            repo_root: repo_root.to_owned(),
            path,
            _temp_dir: temp_dir,
        })
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for BaseWorktree {
    fn drop(&mut self) {
        let result = Command::new("git")
            .current_dir(&self.repo_root)
            .args(["worktree", "remove", "--force"])
            .arg(&self.path)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        if !matches!(result, Ok(status) if status.success()) {
            eprintln!(
                "warning: failed to unregister temporary worktree {}",
                self.path.display()
            );
        }
    }
}
