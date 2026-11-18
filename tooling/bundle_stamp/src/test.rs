use std::{path::Path, process::Command};

use bundle_identity::{BundleManifest, CommitTime, NativeFloor, SourceCommit};

use super::{git_commit, native_floor, stamp, verify};

const COMMIT_SECS: u64 = 1_794_870_406;
const SHA: &str = "cd95980272a4cfd4d0d5e6d2a3a8a1b0c9f8e7d6";

fn git(repo: &Path, args: &[&str]) {
    let status = Command::new("git")
        .args(args)
        .current_dir(repo)
        .env("GIT_AUTHOR_NAME", "test")
        .env("GIT_AUTHOR_EMAIL", "test@example.com")
        .env("GIT_COMMITTER_NAME", "test")
        .env("GIT_COMMITTER_EMAIL", "test@example.com")
        .env("GIT_AUTHOR_DATE", format!("@{COMMIT_SECS} +0000"))
        .env("GIT_COMMITTER_DATE", format!("@{COMMIT_SECS} +0000"))
        .status()
        .unwrap();
    assert!(status.success(), "git {args:?} failed");
}

fn repo_with_one_commit() -> tempfile::TempDir {
    let repo = tempfile::tempdir().unwrap();
    git(repo.path(), &["init", "-q"]);
    git(repo.path(), &["commit", "-q", "--allow-empty", "-m", "one"]);
    repo
}

fn dist(index_html: &str) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("index.html"), index_html).unwrap();
    std::fs::write(dir.path().join("package.json"), r#"{"version":"2.5.0"}"#).unwrap();
    dir
}

fn commit(sha: &str, secs: u64) -> SourceCommit {
    SourceCommit::new(sha.parse().unwrap(), CommitTime::try_new(secs).unwrap())
}

fn stamp_dist(dir: &Path, source: SourceCommit) -> BundleManifest {
    stamp(
        dir,
        &dir.join("package.json"),
        source,
        None,
        NativeFloor::Shared {
            min_native_build: 0,
        },
    )
    .unwrap()
}

#[test]
fn stamps_the_head_commit_into_manifest_and_index() {
    let repo = repo_with_one_commit();
    let source = git_commit(repo.path(), "HEAD").unwrap();
    assert_eq!(source.time().secs(), COMMIT_SECS);

    let dist = dist(r#"<meta name="macro-bundle-build" content="__MACRO_BUNDLE_BUILD__">"#);
    stamp_dist(dist.path(), source.clone());

    let written = BundleManifest::read_file(&dist.path().join("bundle-manifest.json")).unwrap();
    assert_eq!(written.source(), &source);
    assert_eq!(written.bundle_build().get(), COMMIT_SECS * 1000);
    assert_eq!(
        std::fs::read_to_string(dist.path().join("index.html")).unwrap(),
        r#"<meta name="macro-bundle-build" content="1794870406000">"#
    );
}

#[test]
fn a_missing_placeholder_fails_without_writing_a_manifest() {
    let dist = dist("<html></html>");
    let result = stamp(
        dist.path(),
        &dist.path().join("package.json"),
        commit(SHA, COMMIT_SECS),
        None,
        NativeFloor::Shared {
            min_native_build: 0,
        },
    );

    assert!(result.is_err());
    assert!(!dist.path().join("bundle-manifest.json").exists());
}

#[test]
fn shallow_clones_stamp_the_same_identity() {
    let repo = repo_with_one_commit();
    git(repo.path(), &["commit", "-q", "--allow-empty", "-m", "two"]);
    let full = git_commit(repo.path(), "HEAD").unwrap();

    let clone = tempfile::tempdir().unwrap();
    let origin = format!("file://{}", repo.path().display());
    git(
        clone.path(),
        &["clone", "-q", "--depth", "1", &origin, "shallow"],
    );

    assert_eq!(
        git_commit(&clone.path().join("shallow"), "HEAD").unwrap(),
        full
    );
}

#[test]
fn both_mobile_minima_select_schema_3() {
    let floor = native_floor(0, Some(2_050_001), Some(184)).unwrap();
    assert_eq!(
        floor,
        NativeFloor::PerPlatform {
            min_native_build: 0,
            android: 2_050_001,
            ios: 184
        }
    );
    assert_eq!(
        native_floor(5, None, None).unwrap(),
        NativeFloor::Shared {
            min_native_build: 5
        }
    );
}

#[test]
fn incomplete_or_unsafe_minima_fail() {
    assert!(native_floor(0, Some(2), None).is_err());
    assert!(native_floor(0, None, Some(2)).is_err());
    assert!(native_floor(0, Some(9_007_199_254_740_992), Some(1)).is_err());
}

#[test]
fn verify_checks_the_commit_and_the_live_bundle() {
    let dist = dist("__MACRO_BUNDLE_BUILD__");
    stamp_dist(dist.path(), commit(SHA, COMMIT_SECS));
    let other: bundle_identity::CommitSha =
        "0123456789abcdef0123456789abcdef01234567".parse().unwrap();

    assert!(verify(dist.path(), &SHA.parse().unwrap(), None).is_ok());
    assert!(verify(dist.path(), &other, None).is_err());

    let live = tempfile::tempdir().unwrap();
    let live_path = live.path().join("live.json");
    let check = |live_json: &str| {
        std::fs::write(&live_path, live_json).unwrap();
        verify(dist.path(), &SHA.parse().unwrap(), Some(&live_path))
    };

    // Re-running the deploy of the live commit is fine.
    let same = std::fs::read_to_string(dist.path().join("bundle-manifest.json")).unwrap();
    assert!(check(&same).is_ok());

    let newer_live = BundleManifest::new(
        commit("0123456789abcdef0123456789abcdef01234567", COMMIT_SECS + 1),
        None,
        NativeFloor::Shared {
            min_native_build: 0,
        },
        "2.5.0".into(),
    );
    assert!(check(&serde_json::to_string(&newer_live).unwrap()).is_err());

    // Legacy live manifests are numbered by build time.
    let legacy = |bundle_build: u64| {
        format!(
            r#"{{"schemaVersion":2,"bundleBuild":{bundle_build},"minNativeBuild":0,"gitSha":"cd95980","appVersion":"2.5.0"}}"#
        )
    };
    assert!(check(&legacy(COMMIT_SECS * 1000 - 1)).is_ok());
    assert!(check(&legacy(COMMIT_SECS * 1000 + 1)).is_err());

    // A live manifest claiming a commit must be consistent with it.
    let inconsistent = format!(
        r#"{{"schemaVersion":2,"bundleBuild":1,"commitTime":{COMMIT_SECS},"gitSha":"{SHA}","minNativeBuild":0,"appVersion":"2.5.0"}}"#
    );
    assert!(check(&inconsistent).is_err());
}
