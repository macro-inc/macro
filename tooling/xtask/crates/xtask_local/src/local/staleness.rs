//! Which running services are on older code than the tree.
//!
//! `stack update --services` and `run_local rebuild --services` rebuild only the
//! named services, so the others keep running whatever they were last built
//! from. Each instance records, per service, when its binary was last built and
//! at which commit (`service-builds.json` in the instance dir). After a partial
//! rebuild, a service is stale when a file in its crate closure changed since its
//! own last build. A full rebuild clears the list. `status` and the update
//! output report it, so a stale service is never debugged by accident.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};

use super::instance::Instance;
use super::inventory::RustService;

#[cfg(test)]
mod test;

const FILE: &str = "service-builds.json";

/// Repository files outside any package whose change can affect every service.
const SHARED_BUILD_FILES: &[&str] = &[
    "Cargo.lock",
    "Cargo.toml",
    "rust-toolchain.toml",
    ".cargo/config.toml",
];

/// When a build started and at which commit, so later edits can be told from
/// ones already in the binary.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct BuildMark {
    pub head: String,
    pub started_unix: i64,
}

impl BuildMark {
    /// Taken just before a build: an edit made during the build then counts as
    /// newer than it, which can only over-report staleness.
    pub fn now(repo: &Path) -> Result<BuildMark> {
        Ok(BuildMark {
            head: git(repo, &["rev-parse", "HEAD"])?.trim().to_owned(),
            started_unix: unix_now(),
        })
    }
}

/// An instance's record: each service's last build, and the services found
/// stale at the last partial rebuild.
#[derive(Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ServiceBuilds {
    pub services: BTreeMap<String, BuildMark>,
    pub stale: Vec<String>,
}

fn path(instance: &Instance) -> PathBuf {
    instance.artifact_dir().join(FILE)
}

pub fn read(instance: &Instance) -> Option<ServiceBuilds> {
    let text = std::fs::read_to_string(path(instance)).ok()?;
    serde_json::from_str(&text).ok()
}

fn write(instance: &Instance, builds: &ServiceBuilds) -> Result<()> {
    let file = path(instance);
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir)?;
    }
    std::fs::write(&file, serde_json::to_string_pretty(builds)?)
        .with_context(|| format!("writing {}", file.display()))
}

/// The stale services recorded for `instance` (none when nothing is recorded).
pub fn stale(instance: &Instance) -> Vec<String> {
    read(instance).map(|b| b.stale).unwrap_or_default()
}

/// Forget what the services were built from: a prebuilt binaries dir or
/// `--no-build` gives no build to compare against.
pub fn clear(instance: &Instance) {
    let _ = std::fs::remove_file(path(instance));
}

/// Every service was just built from `mark`, so none is stale.
pub fn record_full<'a>(
    instance: &Instance,
    mark: &BuildMark,
    services: impl Iterator<Item = &'a RustService>,
) -> Result<()> {
    let builds = ServiceBuilds {
        services: services
            .map(|svc| (svc.compose_name.to_owned(), mark.clone()))
            .collect(),
        stale: Vec::new(),
    };
    write(instance, &builds)
}

/// Only `built` was just built from `mark`. Records it, works out which of
/// `all`'s other services now run older code than the tree, records that, and
/// returns it.
pub fn record_partial(
    instance: &Instance,
    repo: &Path,
    mark: &BuildMark,
    built: &[&RustService],
    all: &[&RustService],
) -> Result<Vec<String>> {
    let mut builds = read(instance).unwrap_or_default();
    for svc in built {
        builds
            .services
            .insert(svc.compose_name.to_owned(), mark.clone());
    }
    let graph = PackageGraph::load(repo)?;
    // Services built together share a mark, so look its files up once.
    let mut changed_since: HashMap<BuildMark, Vec<PathBuf>> = HashMap::new();
    let mut stale = Vec::new();
    for svc in all {
        if built.iter().any(|b| b.compose_name == svc.compose_name) {
            continue;
        }
        let is_stale = match builds.services.get(svc.compose_name) {
            // Never built here, or built before this record existed.
            None => true,
            Some(since) => {
                if !changed_since.contains_key(since) {
                    changed_since.insert(since.clone(), changed_files(repo, since)?);
                }
                let changed = changed_since.get(since).map_or(&[][..], Vec::as_slice);
                graph.is_affected(svc.package, changed)
            }
        };
        if is_stale {
            stale.push(svc.compose_name.to_owned());
        }
    }
    builds.stale = stale.clone();
    write(instance, &builds)?;
    Ok(stale)
}

/// The commands that bring stale services current.
pub fn hint(instance_flags: &str) -> String {
    format!("`just run_local rebuild{instance_flags}` or `just stack update{instance_flags}`")
}

/// One line naming the stale services and how to rebuild them, if any.
pub fn notice(stale: &[String], instance_flags: &str) -> Option<String> {
    (!stale.is_empty()).then(|| {
        format!(
            "{} service{} on older code than the tree: {}. Rebuild all with {}.",
            stale.len(),
            if stale.len() == 1 { " is" } else { "s are" },
            stale.join(", "),
            hint(instance_flags)
        )
    })
}

/// Files changed since `since`: those that differ from its commit or are new,
/// and were written after its build started (or are gone).
fn changed_files(repo: &Path, since: &BuildMark) -> Result<Vec<PathBuf>> {
    let mut names: BTreeSet<String> = BTreeSet::new();
    // A bad or unknown commit (rewritten history) counts every file as changed,
    // which only over-reports.
    match git(repo, &["diff", "--name-only", &since.head]) {
        Ok(out) => names.extend(out.lines().map(str::to_owned)),
        Err(_) => return Ok(vec![PathBuf::from("Cargo.lock")]),
    }
    let untracked = git(repo, &["ls-files", "--others", "--exclude-standard"])?;
    names.extend(untracked.lines().map(str::to_owned));
    Ok(names
        .into_iter()
        .map(PathBuf::from)
        .filter(|rel| match std::fs::metadata(repo.join(rel)) {
            Ok(meta) => meta
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .is_none_or(|t| t.as_secs() as i64 >= since.started_unix),
            Err(_) => true,
        })
        .collect())
}

/// Workspace packages, where they live, and what each depends on.
pub struct PackageGraph {
    /// Package name and its directory relative to the repository root.
    dirs: Vec<(String, PathBuf)>,
    /// Package name to the workspace packages it depends on (normal and build).
    deps: HashMap<String, Vec<String>>,
}

impl PackageGraph {
    fn load(repo: &Path) -> Result<PackageGraph> {
        let out = Command::new("cargo")
            .current_dir(repo)
            .args(["metadata", "--format-version", "1", "--offline"])
            .output()
            .context("running `cargo metadata`")?;
        if !out.status.success() {
            bail!(
                "`cargo metadata` failed: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            );
        }
        let meta: serde_json::Value =
            serde_json::from_slice(&out.stdout).context("parsing `cargo metadata`")?;
        PackageGraph::from_metadata(&meta, repo)
    }

    fn from_metadata(meta: &serde_json::Value, repo: &Path) -> Result<PackageGraph> {
        let members: HashSet<&str> = meta["workspace_members"]
            .as_array()
            .context("no workspace_members")?
            .iter()
            .filter_map(|m| m.as_str())
            .collect();
        let mut names: HashMap<&str, String> = HashMap::new();
        let mut dirs = Vec::new();
        for pkg in meta["packages"].as_array().context("no packages")? {
            let (Some(id), Some(name), Some(manifest)) = (
                pkg["id"].as_str(),
                pkg["name"].as_str(),
                pkg["manifest_path"].as_str(),
            ) else {
                continue;
            };
            if !members.contains(id) {
                continue;
            }
            names.insert(id, name.to_owned());
            if let Some(dir) = Path::new(manifest).parent() {
                let rel = dir.strip_prefix(repo).unwrap_or(dir).to_path_buf();
                dirs.push((name.to_owned(), rel));
            }
        }
        let mut deps: HashMap<String, Vec<String>> = HashMap::new();
        for node in meta["resolve"]["nodes"].as_array().context("no resolve")? {
            let Some(name) = node["id"].as_str().and_then(|id| names.get(id)) else {
                continue;
            };
            let entry = deps.entry(name.clone()).or_default();
            for dep in node["deps"].as_array().into_iter().flatten() {
                let counts = dep["dep_kinds"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .any(|k| matches!(k["kind"].as_str(), None | Some("build")));
                if let (true, Some(dep_name)) =
                    (counts, dep["pkg"].as_str().and_then(|id| names.get(id)))
                {
                    entry.push(dep_name.clone());
                }
            }
        }
        Ok(PackageGraph { dirs, deps })
    }

    /// Whether any of `changed` (repository-relative paths) is in `package` or a
    /// workspace package it depends on, or is a file every build reads.
    fn is_affected(&self, package: &str, changed: &[PathBuf]) -> bool {
        let packages = self.packages_of(changed);
        if packages.shared {
            return true;
        }
        let closure = self.closure(package);
        packages.names.iter().any(|name| closure.contains(name))
    }

    fn packages_of(&self, changed: &[PathBuf]) -> ChangedPackages {
        let mut out = ChangedPackages::default();
        for file in changed {
            if SHARED_BUILD_FILES.iter().any(|f| file == Path::new(f)) {
                out.shared = true;
                continue;
            }
            // The innermost package directory holding the file.
            let owner = self
                .dirs
                .iter()
                .filter(|(_, dir)| file.starts_with(dir))
                .max_by_key(|(_, dir)| dir.components().count());
            if let Some((name, _)) = owner {
                out.names.insert(name.clone());
            }
        }
        out
    }

    fn closure(&self, package: &str) -> HashSet<String> {
        let mut seen = HashSet::new();
        let mut todo = vec![package.to_owned()];
        while let Some(name) = todo.pop() {
            if !seen.insert(name.clone()) {
                continue;
            }
            if let Some(deps) = self.deps.get(&name) {
                todo.extend(deps.iter().cloned());
            }
        }
        seen
    }
}

#[derive(Default)]
struct ChangedPackages {
    names: HashSet<String>,
    shared: bool,
}

fn git(repo: &Path, args: &[&str]) -> Result<String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(args)
        .output()
        .with_context(|| format!("running git {}", args.join(" ")))?;
    if !out.status.success() {
        bail!(
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&out.stderr).trim()
        );
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

fn unix_now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}
