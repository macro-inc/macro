use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::Command;

fn scripts_dir() -> PathBuf {
    xtask_paths::repo_root().join(".github/scripts")
}

fn write_executable(path: &Path, contents: &str) {
    std::fs::write(path, contents).unwrap();
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
}

fn path_with(dir: &Path) -> String {
    format!("{}:{}", dir.display(), std::env::var("PATH").unwrap())
}

/// Runs the state script with a fake `npx` and returns (`unchanged`, `wait_seconds`, success).
fn worker_state(key: &str, status: &str, view: &str) -> (String, i64, bool) {
    let dir = tempfile::tempdir().unwrap();
    write_executable(
        &dir.path().join("npx"),
        &format!(
            "#!/usr/bin/env bash\ncase \"$2\" in\n  deployments) {status} ;;\n  versions) {view} ;;\n  *) exit 99 ;;\nesac\n"
        ),
    );
    let output_path = dir.path().join("output");
    std::fs::write(&output_path, "").unwrap();
    let output = Command::new("bash")
        .arg(scripts_dir().join("sync-worker-state.sh"))
        .current_dir(dir.path())
        .env("PATH", path_with(dir.path()))
        .env("GITHUB_OUTPUT", &output_path)
        .env("ENVIRONMENT", "dev")
        .env("WORKER_KEY", key)
        .output()
        .unwrap();
    let written = std::fs::read_to_string(output_path).unwrap();
    let value = |name: &str| {
        written
            .lines()
            .find_map(|line| line.strip_prefix(&format!("{name}=")).map(str::to_string))
            .unwrap_or_default()
    };
    (
        value("unchanged"),
        value("wait_seconds").parse().unwrap_or(-1),
        output.status.success(),
    )
}

fn status_at(seconds_ago: i64) -> String {
    let created_on = String::from_utf8(
        Command::new("date")
            .args(["-u", "-d", &format!("{seconds_ago} seconds ago"), "+%FT%TZ"])
            .output()
            .unwrap()
            .stdout,
    )
    .unwrap();
    format!(
        "echo '{{\"created_on\":\"{}\",\"versions\":[{{\"version_id\":\"v1\",\"percentage\":100}}]}}'",
        created_on.trim()
    )
}

const MATCHING_VIEW: &str = "echo '{\"annotations\":{\"workers/message\":\"inputs:abc\"}}'";

#[test]
fn matching_inputs_skip_deployment_once_the_deferral_has_passed() {
    let (unchanged, wait, ok) = worker_state("abc", &status_at(3600), MATCHING_VIEW);
    assert!(ok);
    assert_eq!(unchanged, "true");
    assert_eq!(wait, 0);
}

#[test]
fn matching_inputs_wait_out_what_remains_of_a_recent_deployment() {
    // A run cancelled during its wait must not unblock clients early.
    let (unchanged, wait, ok) = worker_state("abc", &status_at(100), MATCHING_VIEW);
    assert!(ok);
    assert_eq!(unchanged, "true");
    assert!((190..=200).contains(&wait), "waited {wait}");
}

#[test]
fn anything_but_a_clear_match_deploys_and_waits_in_full() {
    let two_versions = "echo '{\"created_on\":\"2026-01-01T00:00:00Z\",\"versions\":[{\"version_id\":\"a\",\"percentage\":50},{\"version_id\":\"b\",\"percentage\":50}]}'";
    let partial = "echo '{\"created_on\":\"2026-01-01T00:00:00Z\",\"versions\":[{\"version_id\":\"a\",\"percentage\":10}]}'";
    let old = status_at(3600);
    for (name, key, status, view) in [
        ("different inputs", "other", old.as_str(), MATCHING_VIEW),
        ("no key", "", old.as_str(), MATCHING_VIEW),
        ("status fails", "abc", "exit 1", MATCHING_VIEW),
        ("status is not JSON", "abc", "echo nope", MATCHING_VIEW),
        ("no deployment", "abc", "echo null", MATCHING_VIEW),
        ("gradual rollout", "abc", two_versions, MATCHING_VIEW),
        ("partial rollout", "abc", partial, MATCHING_VIEW),
        ("view fails", "abc", old.as_str(), "exit 1"),
        (
            "no message",
            "abc",
            old.as_str(),
            "echo '{\"annotations\":{}}'",
        ),
        ("no annotations", "abc", old.as_str(), "echo '{}'"),
    ] {
        let (unchanged, wait, ok) = worker_state(key, status, view);
        assert!(ok, "{name}: a read failure must not fail the job");
        assert_eq!(unchanged, "false", "{name}");
        assert_eq!(wait, 300, "{name}");
    }
}

fn git(dir: &Path, args: &[&str]) {
    let status = Command::new("git")
        .args(["-c", "user.name=t", "-c", "user.email=t@example.com"])
        .args(args)
        .current_dir(dir)
        .output()
        .unwrap()
        .status;
    assert!(status.success(), "git {args:?}");
}

fn commit_change(dir: &Path, file: &str, contents: &str) {
    let path = dir.join(file);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, contents).unwrap();
    git(dir, &["add", "-A"]);
    git(dir, &["commit", "-qm", "change"]);
}

fn worker_key(dir: &Path) -> String {
    let output = Command::new("bash")
        .arg(scripts_dir().join("sync-worker-key.sh"))
        .current_dir(dir)
        .env("PATH", path_with(&dir.join("bin")))
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).unwrap().trim().to_string()
}

#[test]
fn the_key_follows_worker_inputs_and_ignores_everything_else() {
    let repo = tempfile::tempdir().unwrap();
    let dir = repo.path();
    let bin = dir.join("bin");
    std::fs::create_dir(&bin).unwrap();
    // The fake resolver reads a tracked file, standing in for what the worker resolves.
    write_executable(
        &bin.join("cargo"),
        "#!/usr/bin/env bash\ncat resolved.txt\n",
    );
    git(dir, &["init", "-q"]);
    for (file, contents) in [
        (
            ".github/workspace-dep-closures.json",
            r#"{"closures":{"sync_service":["services/sync-service"]}}"#,
        ),
        ("services/sync-service/src/lib.rs", "one"),
        ("services/other/src/lib.rs", "one"),
        ("Cargo.toml", "[profile.release]\nlto = false\n"),
        ("resolved.txt", "serde v1.0.0 default\n"),
        ("rust-toolchain.toml", "[toolchain]\nchannel = \"1.94.0\"\n"),
    ] {
        commit_change(dir, file, contents);
    }
    let base = worker_key(dir);

    commit_change(dir, "services/other/src/lib.rs", "two");
    commit_change(
        dir,
        "Cargo.toml",
        "[profile.release]\nlto = false\n[workspace.dependencies]\nother = \"1\"\n",
    );
    assert_eq!(worker_key(dir), base, "unrelated changes must not count");

    let mut previous = base;
    for (name, file, contents) in [
        ("worker source", "services/sync-service/src/lib.rs", "two"),
        ("resolved crates", "resolved.txt", "serde v1.0.1 default\n"),
        (
            "toolchain",
            "rust-toolchain.toml",
            "[toolchain]\nchannel = \"1.95.0\"\n",
        ),
        ("cargo config", ".cargo/config.toml", "[build]\n"),
        ("vendored crate", "vendor/patched/src/lib.rs", "one"),
        (
            "release profile",
            "Cargo.toml",
            "[profile.release]\nlto = true\n[workspace.dependencies]\nother = \"1\"\n",
        ),
    ] {
        commit_change(dir, file, contents);
        let key = worker_key(dir);
        assert_ne!(key, previous, "{name} must change the key");
        previous = key;
    }
}

#[test]
fn a_failed_input_read_prints_no_key() {
    let repo = tempfile::tempdir().unwrap();
    let dir = repo.path();
    let bin = dir.join("bin");
    std::fs::create_dir(&bin).unwrap();
    write_executable(
        &bin.join("cargo"),
        "#!/usr/bin/env bash\necho partial\nexit 1\n",
    );
    git(dir, &["init", "-q"]);
    commit_change(
        dir,
        ".github/workspace-dep-closures.json",
        r#"{"closures":{"sync_service":["services/sync-service"]}}"#,
    );
    commit_change(dir, "services/sync-service/src/lib.rs", "one");
    commit_change(dir, "Cargo.toml", "");

    let output = Command::new("bash")
        .arg(scripts_dir().join("sync-worker-key.sh"))
        .current_dir(dir)
        .env("PATH", path_with(&bin))
        .output()
        .unwrap();

    assert!(!output.status.success());
    assert!(
        output.stdout.is_empty(),
        "a partial hash could later match and skip a deployment"
    );
}
