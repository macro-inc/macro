use std::collections::BTreeSet;
use std::path::{Component, Path, PathBuf};

use super::*;

/// `path` with its `.` and `..` components resolved, without touching the
/// file system.
fn normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other),
        }
    }
    out
}

/// The directories of a manifest's local dependencies that every build of it
/// compiles: normal and build dependencies, including target-specific ones,
/// that are not optional. Dev dependencies build only its tests.
fn local_dependencies(root: &Path, crate_dir: &Path, workspace: &toml::Value) -> Vec<PathBuf> {
    let manifest: toml::Value = toml::from_str(
        &std::fs::read_to_string(root.join(crate_dir).join("Cargo.toml")).expect("read manifest"),
    )
    .expect("parse manifest");
    let mut tables: Vec<&toml::Value> = ["dependencies", "build-dependencies"]
        .iter()
        .filter_map(|key| manifest.get(*key))
        .collect();
    if let Some(targets) = manifest.get("target").and_then(toml::Value::as_table) {
        for target in targets.values() {
            tables.extend(
                ["dependencies", "build-dependencies"]
                    .iter()
                    .filter_map(|key| target.get(*key)),
            );
        }
    }
    let workspace_dependencies = workspace
        .get("workspace")
        .and_then(|table| table.get("dependencies"));
    let mut found = Vec::new();
    for table in tables {
        for (name, dependency) in table.as_table().expect("dependency table") {
            if dependency.get("optional").and_then(toml::Value::as_bool) == Some(true) {
                continue;
            }
            let from_workspace =
                dependency.get("workspace").and_then(toml::Value::as_bool) == Some(true);
            let path = if from_workspace {
                workspace_dependencies
                    .and_then(|dependencies| dependencies.get(name))
                    .and_then(|dependency| dependency.get("path"))
                    .and_then(toml::Value::as_str)
                    .map(PathBuf::from)
            } else {
                dependency
                    .get("path")
                    .and_then(toml::Value::as_str)
                    .map(|path| crate_dir.join(path))
            };
            if let Some(path) = path {
                found.push(normalize(&path));
            }
        }
    }
    found
}

/// A local crate a listed WASM crate compiles but the list misses could change
/// the shipped app on a pull request whose web checks and Cache Harness never
/// run.
#[test]
fn paths_cover_every_local_crate_the_listed_crates_build() {
    let root = xtask_paths::repo_root();
    let workspace: toml::Value = toml::from_str(
        &std::fs::read_to_string(root.join("Cargo.toml")).expect("read workspace manifest"),
    )
    .expect("parse workspace manifest");
    let prefixes: Vec<&str> = WEB_ARTIFACT_PATHS
        .iter()
        .filter_map(|glob| glob.as_str().strip_suffix("/**"))
        .collect();
    let covered = |dir: &Path| prefixes.iter().any(|prefix| dir.starts_with(prefix));
    let mut todo: Vec<PathBuf> = prefixes
        .iter()
        .map(PathBuf::from)
        .filter(|dir| dir.starts_with("crates") && root.join(dir).join("Cargo.toml").is_file())
        .collect();
    let mut seen = BTreeSet::new();
    let mut missing = BTreeSet::new();
    while let Some(dir) = todo.pop() {
        if !seen.insert(dir.clone()) {
            continue;
        }
        for dependency in local_dependencies(&root, &dir, &workspace) {
            if !covered(&dependency) {
                missing.insert(format!("{} (from {})", dependency.display(), dir.display()));
            }
            todo.push(dependency);
        }
    }
    assert!(
        missing.is_empty(),
        "WEB_ARTIFACT_PATHS has no glob for: {missing:#?}"
    );
}

/// The WASM builds read the workspace's Cargo configuration (target flags).
#[test]
fn paths_cover_the_cargo_configuration() {
    assert!(
        WEB_ARTIFACT_PATHS
            .iter()
            .any(|glob| glob.as_str() == ".cargo/config.toml")
    );
}
