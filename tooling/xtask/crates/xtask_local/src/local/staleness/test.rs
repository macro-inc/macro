use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::json;

use super::*;
use crate::local::test_support::TempDir;

/// A workspace where `service_a` depends on `hub`, `service_b` doesn't, and
/// `hub` has a build dependency on `codegen`.
fn graph() -> PackageGraph {
    let repo = Path::new("/repo");
    let meta = json!({
        "workspace_members": ["hub-id", "codegen-id", "a-id", "b-id"],
        "packages": [
            {"id": "hub-id", "name": "hub", "manifest_path": "/repo/crates/hub/Cargo.toml"},
            {"id": "codegen-id", "name": "codegen", "manifest_path": "/repo/crates/codegen/Cargo.toml"},
            {"id": "a-id", "name": "service_a", "manifest_path": "/repo/services/service_a/Cargo.toml"},
            {"id": "b-id", "name": "service_b", "manifest_path": "/repo/services/service_b/Cargo.toml"},
            {"id": "serde-id", "name": "serde", "manifest_path": "/registry/serde/Cargo.toml"}
        ],
        "resolve": {"nodes": [
            {"id": "a-id", "deps": [
                {"pkg": "hub-id", "dep_kinds": [{"kind": null}]},
                {"pkg": "serde-id", "dep_kinds": [{"kind": null}]}
            ]},
            {"id": "hub-id", "deps": [{"pkg": "codegen-id", "dep_kinds": [{"kind": "build"}]}]},
            {"id": "b-id", "deps": [{"pkg": "hub-id", "dep_kinds": [{"kind": "dev"}]}]},
            {"id": "codegen-id", "deps": []}
        ]}
    });
    PackageGraph::from_metadata(&meta, repo).unwrap()
}

fn files(paths: &[&str]) -> Vec<PathBuf> {
    paths.iter().map(PathBuf::from).collect()
}

#[test]
fn an_edit_in_a_dependency_makes_its_dependents_stale() {
    let g = graph();
    let changed = files(&["crates/hub/src/lib.rs"]);
    assert!(g.is_affected("service_a", &changed));
    // A dev-dependency doesn't reach the binary.
    assert!(!g.is_affected("service_b", &changed));
}

#[test]
fn build_dependencies_count() {
    let changed = files(&["crates/codegen/src/main.rs"]);
    assert!(graph().is_affected("service_a", &changed));
}

#[test]
fn files_outside_packages_affect_nothing_but_shared_build_files_affect_all() {
    let g = graph();
    assert!(!g.is_affected("service_a", &files(&["docs/README.md", "apps/web/x.ts"])));
    assert!(g.is_affected("service_b", &files(&["Cargo.lock"])));
    assert!(g.is_affected("service_b", &files(&["rust-toolchain.toml"])));
}

#[test]
fn a_service_is_affected_by_its_own_files() {
    let changed = files(&["services/service_b/src/main.rs"]);
    assert!(graph().is_affected("service_b", &changed));
    assert!(!graph().is_affected("service_a", &changed));
}

#[test]
fn notice_names_the_services_and_the_fix() {
    assert_eq!(notice(&[], " --instance a"), None);
    let one = notice(&["email_service".to_owned()], " --instance a").unwrap();
    assert!(one.starts_with("1 service is on older code than the tree: email_service."));
    assert!(one.ends_with(
        "Rebuild all with `just run_local rebuild --instance a` or `just stack update --instance a`."
    ));
    let two = notice(&["a".to_owned(), "b".to_owned()], "").unwrap();
    assert!(two.starts_with("2 services are on older code than the tree: a, b."));
}

fn run_git(dir: &Path, args: &[&str]) {
    let ok = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(["-c", "user.name=t", "-c", "user.email=t@example.com"])
        .args(args)
        .status()
        .unwrap()
        .success();
    assert!(ok, "git {args:?}");
}

fn set_mtime(path: &Path, unix: i64) {
    std::fs::File::options()
        .write(true)
        .open(path)
        .unwrap()
        .set_modified(UNIX_EPOCH + std::time::Duration::from_secs(unix as u64))
        .unwrap();
}

/// Only edits made after a build count: an uncommitted change that was already
/// in the tree when the service was built doesn't make it stale.
#[test]
fn changed_files_are_the_ones_written_after_the_build() {
    let tmp = TempDir::new("staleness-git");
    let repo = tmp.path();
    run_git(repo, &["init", "-q"]);
    std::fs::create_dir_all(repo.join("crates/hub/src")).unwrap();
    std::fs::write(repo.join("crates/hub/src/lib.rs"), "v1").unwrap();
    std::fs::write(repo.join("crates/hub/src/old.rs"), "v1").unwrap();
    run_git(repo, &["add", "-A"]);
    run_git(repo, &["commit", "-q", "-m", "init"]);

    // Edited before the build, so already in the binary.
    std::fs::write(repo.join("crates/hub/src/old.rs"), "v2").unwrap();
    set_mtime(&repo.join("crates/hub/src/old.rs"), 1_000);
    let mark = BuildMark {
        head: git(repo, &["rev-parse", "HEAD"]).unwrap().trim().to_owned(),
        started_unix: 2_000,
    };
    // After the build: an edit, a new file, and a deletion.
    std::fs::write(repo.join("crates/hub/src/lib.rs"), "v2").unwrap();
    set_mtime(&repo.join("crates/hub/src/lib.rs"), 3_000);
    std::fs::write(repo.join("crates/hub/src/new.rs"), "new").unwrap();
    set_mtime(&repo.join("crates/hub/src/new.rs"), 3_000);

    let changed = changed_files(repo, &mark).unwrap();
    assert_eq!(
        changed,
        files(&["crates/hub/src/lib.rs", "crates/hub/src/new.rs"])
    );

    std::fs::remove_file(repo.join("crates/hub/src/lib.rs")).unwrap();
    let changed = changed_files(repo, &mark).unwrap();
    assert!(changed.contains(&PathBuf::from("crates/hub/src/lib.rs")));
}

#[test]
fn an_unknown_commit_counts_as_every_file_changed() {
    let tmp = TempDir::new("staleness-unknown");
    let repo = tmp.path();
    run_git(repo, &["init", "-q"]);
    std::fs::write(repo.join("a"), "a").unwrap();
    run_git(repo, &["add", "-A"]);
    run_git(repo, &["commit", "-q", "-m", "init"]);
    let mark = BuildMark {
        head: "0000000000000000000000000000000000000000".to_owned(),
        started_unix: 0,
    };
    let changed = changed_files(repo, &mark).unwrap();
    assert!(graph().is_affected("service_b", &changed));
}
