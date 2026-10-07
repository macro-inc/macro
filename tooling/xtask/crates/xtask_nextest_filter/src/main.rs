//! `cargo x nextest-filter <changed-files-path> <base-revision>`
//!
//! Computes the set of workspace packages cargo nextest / clippy should run
//! for Rust CI using [`determinator`].
//!
//! Input is a newline-delimited file of paths relative to the repository root
//! (typically `git diff --name-only ...`) and a Git base revision. When no
//! `Cargo.toml` or `Cargo.lock` changed, the package graph is identical on
//! both sides, so the command maps paths to packages (determinator's path
//! rules) and adds their reverse dependencies from the current graph alone.
//! Otherwise it builds Cargo metadata for the base and current revisions and
//! lets determinator account for dependency and feature changes as well.
//! Shared inputs that Cargo does not know about are declared in
//! `determinator.toml`.
//!
//! A root `Cargo.toml` edit forces `all` unless it only touches
//! `workspace.members` / `workspace.dependencies`; see
//! [`root_manifest_change_forces_all`].
//!
//! Stdout is one of:
//! - `all` — every workspace package is affected.
//! - `none` — no changed file mapped to a package (a top-level JSON, a Nix
//!   shell tweak, docs, …). CI must not treat this as "run everything".
//! - space-separated package names — pass each as `cargo nextest run -p` /
//!   `cargo clippy -p`.

use std::collections::BTreeSet;
use std::fmt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use anyhow::{Context, Result, bail};
use determinator::Determinator;
use determinator::rules::{DeterminatorRules, PathMatch};
use guppy::PackageId;
use guppy::graph::cargo::{CargoOptions, CargoSet};
use guppy::graph::feature::{FeatureSet, StandardFeatures};
use guppy::graph::{DependencyDirection, PackageGraph, PackageMetadata};
use tempfile::TempDir;
#[cfg(test)]
use xtask_graph::build_graph;
use xtask_graph::build_graph_at;

#[cfg(test)]
mod test;

const DETERMINATOR_RULES: &str = include_str!("../determinator.toml");

/// Which workspace packages Rust CI should compile and test.
///
/// Stringified only at the CLI seam (`Display`) so bash can switch on `all`,
/// `none`, or a space-separated package list.
#[derive(Debug, Clone, PartialEq, Eq)]
enum PackageSelection {
    /// Every workspace package is affected.
    All,
    /// No changed file mapped to a package.
    None,
    /// Changed packages plus reverse dependencies.
    Packages(BTreeSet<String>),
}

impl fmt::Display for PackageSelection {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::All => f.write_str("all"),
            Self::None => f.write_str("none"),
            Self::Packages(packages) => {
                let mut first = true;
                for name in packages {
                    if !first {
                        f.write_str(" ")?;
                    }
                    first = false;
                    f.write_str(name)?;
                }
                Ok(())
            }
        }
    }
}

#[cfg(test)]
impl PackageSelection {
    fn packages(&self) -> Option<&BTreeSet<String>> {
        match self {
            Self::Packages(packages) => Some(packages),
            Self::All | Self::None => None,
        }
    }
}

fn main() -> Result<()> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    match args.as_slice() {
        [changed_files_path, base_revision] => {
            let base_revision = base_revision
                .to_str()
                .context("base revision is not valid UTF-8")?;
            run(Path::new(changed_files_path), base_revision)
        }
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
    let changed_files: Vec<PathBuf> = changed_files
        .lines()
        .filter(|line| !line.is_empty())
        .map(PathBuf::from)
        .collect();

    let workspace_dir = xtask_paths::workspace_root();
    if !changed_files.iter().any(|path| changes_cargo_graph(path)) {
        let graph = build_graph_at(&workspace_dir, true)?;
        println!(
            "{}",
            select_by_paths(&graph, &changed_files, &repository_rules()?)?
        );
        return Ok(());
    }

    let base_worktree = BaseWorktree::new(&workspace_dir, base_revision)?;
    if changed_files
        .iter()
        .any(|path| path == Path::new(ROOT_MANIFEST))
    {
        let old_manifest = read_manifest(base_worktree.path())?;
        let new_manifest = read_manifest(&workspace_dir)?;
        if root_manifest_change_forces_all(&old_manifest, &new_manifest)? {
            println!("{}", PackageSelection::All);
            return Ok(());
        }
    }
    let (old_graph, new_graph) = build_graphs(base_worktree.path(), &workspace_dir)?;
    let packages = compute_packages(&old_graph, &new_graph, &changed_files, &repository_rules()?)?;
    println!("{packages}");
    Ok(())
}

const ROOT_MANIFEST: &str = "Cargo.toml";

fn read_manifest(dir: &Path) -> Result<String> {
    let path = dir.join(ROOT_MANIFEST);
    std::fs::read_to_string(&path).with_context(|| format!("reading {}", path.display()))
}

/// Root-manifest keys whose edits reach every affected package through the
/// old/new Cargo graphs, so determinator can scope them:
/// - `workspace.members`: an added member is a new package (determinator marks
///   it changed); a removed one changes the manifests that depended on it.
/// - `workspace.dependencies`: members inherit these specs, so a version,
///   source, or feature change shows up in the simulated builds of exactly
///   the members whose resolved dependencies changed. An unused or
///   resolution-neutral edit selects nothing, which is correct.
///
/// Everything else (`[profile.*]`, `[workspace.lints]`, `[workspace.package]`,
/// `[patch]`, `resolver`, …) changes how every package compiles without
/// changing the package graph, so determinator cannot see it.
const GRAPH_VISIBLE_WORKSPACE_KEYS: [&str; 2] = ["members", "dependencies"];

/// Whether a root `Cargo.toml` edit must run the whole workspace: true unless
/// the old and new manifests are equal once the graph-visible workspace keys
/// are removed. Compares parsed TOML, so comment and formatting edits are
/// no-ops.
fn root_manifest_change_forces_all(old: &str, new: &str) -> Result<bool> {
    let strip = |manifest: &str, revision: &str| -> Result<toml::Table> {
        let mut table: toml::Table = manifest
            .parse()
            .with_context(|| format!("parsing the {revision} root {ROOT_MANIFEST}"))?;
        if let Some(toml::Value::Table(workspace)) = table.get_mut("workspace") {
            for key in GRAPH_VISIBLE_WORKSPACE_KEYS {
                workspace.remove(key);
            }
        }
        Ok(table)
    };
    Ok(strip(old, "base")? != strip(new, "current")?)
}

fn build_graphs(base_dir: &Path, current_dir: &Path) -> Result<(PackageGraph, PackageGraph)> {
    Ok((
        build_graph_at(base_dir, true)?,
        build_graph_at(current_dir, true)?,
    ))
}

/// This repository's determinator rules (`determinator.toml`).
fn repository_rules() -> Result<DeterminatorRules> {
    DeterminatorRules::parse(DETERMINATOR_RULES).context("parsing nextest determinator rules")
}

/// Whether a changed path can alter `cargo metadata`: any manifest or
/// lockfile. Without one, the base and current package graphs are identical
/// and determinator's build-summary comparison (several seconds of feature
/// resolution per workspace member) cannot find anything.
fn changes_cargo_graph(path: &Path) -> bool {
    matches!(
        path.file_name().and_then(|name| name.to_str()),
        Some("Cargo.toml" | "Cargo.lock")
    )
}

/// Selection for a change that leaves the package graph untouched: packages
/// owning a changed path (or named by a determinator path rule) plus every
/// workspace package whose own build compiles one of them. That is the set
/// [`compute_packages`] returns when old and new graphs are identical, but
/// determinator gets there by simulating none/default/all-feature builds of
/// every member on both sides (~600 simulations, several seconds). Here only
/// the reverse dependencies of the changed packages are simulated, once.
fn select_by_paths(
    graph: &PackageGraph,
    changed_files: &[PathBuf],
    rules: &DeterminatorRules,
) -> Result<PackageSelection> {
    let mut determinator = Determinator::new(graph, graph);
    determinator
        .set_rules(rules)
        .context("applying nextest determinator rules")?;

    let mut changed = BTreeSet::new();
    for changed_file in changed_files {
        let changed_file = changed_file
            .to_str()
            .context("changed file path is not valid UTF-8")?;
        let matched = determinator.match_path(changed_file, |id| {
            changed.insert(id);
        });
        if matches!(matched, PathMatch::RuleMatchedAll) {
            return Ok(PackageSelection::All);
        }
    }

    // Every package that could build a changed one, following all edges. Cheap,
    // and a superset of the answer.
    let candidates = graph
        .query_reverse(changed.iter().copied())
        .context("querying reverse dependencies")?
        .resolve();
    let cargo_options = Determinator::default_cargo_options();
    let features_only = graph.feature_graph().resolve_none();
    let mut selected = BTreeSet::new();
    for package in candidates
        .packages(DependencyDirection::Forward)
        .filter(|package| package.in_workspace())
    {
        if changed.contains(package.id())
            || builds_any(package, &changed, &cargo_options, &features_only)?
        {
            selected.insert(package.name().to_owned());
        }
    }
    workspace_selection(graph, selected)
}

/// Whether `package`'s own test build with all its features (dev-dependencies
/// included, current platform) compiles any of `changed`. This is the one-hop
/// check determinator's reverse index makes for path changes; enabling more
/// features only adds dependencies, so the all-features build covers the
/// none and default ones it also simulates.
fn builds_any(
    package: PackageMetadata<'_>,
    changed: &BTreeSet<&PackageId>,
    cargo_options: &CargoOptions<'_>,
    features_only: &FeatureSet<'_>,
) -> Result<bool> {
    let initials = package
        .to_package_set()
        .to_feature_set(StandardFeatures::All);
    let build = CargoSet::new(initials, features_only.clone(), cargo_options)
        .with_context(|| format!("simulating the build of {}", package.name()))?;
    let target = build.target_features().to_package_set();
    let host = build.host_features().to_package_set();
    for id in changed {
        if target.contains(id)? || host.contains(id)? {
            return Ok(true);
        }
    }
    Ok(false)
}

/// `None` for an empty set, `All` when it covers the whole workspace.
fn workspace_selection(
    graph: &PackageGraph,
    packages: BTreeSet<String>,
) -> Result<PackageSelection> {
    if packages.is_empty() {
        return Ok(PackageSelection::None);
    }
    if packages.len() == graph.workspace().iter().count() {
        return Ok(PackageSelection::All);
    }
    Ok(PackageSelection::Packages(packages))
}

/// Use determinator to compare both Cargo graphs and return affected package
/// names. Paths outside Cargo packages contribute nothing, preserving the CI
/// behavior for Nix-only and other non-Rust changes.
fn compute_packages(
    old_graph: &PackageGraph,
    new_graph: &PackageGraph,
    changed_files: &[PathBuf],
    rules: &DeterminatorRules,
) -> Result<PackageSelection> {
    let mut determinator = Determinator::new(old_graph, new_graph);
    determinator
        .set_rules(rules)
        .context("applying nextest determinator rules")?;

    for changed_file in changed_files {
        let changed_file = changed_file
            .to_str()
            .context("changed file path is not valid UTF-8")?;
        if !matches!(
            determinator.match_path(changed_file, |_| {}),
            PathMatch::NoMatches
        ) {
            determinator.add_changed_paths([changed_file]);
        }
    }

    let affected = determinator.compute().affected_set;
    workspace_selection(
        new_graph,
        affected
            .packages(DependencyDirection::Forward)
            .filter(|package| package.in_workspace())
            .map(|package| package.name().to_owned())
            .collect(),
    )
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
