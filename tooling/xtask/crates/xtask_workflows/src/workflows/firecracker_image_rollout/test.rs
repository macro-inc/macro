//! The build script's publishing, against stand-ins: `nix` builds three tiny
//! files and runs `nix shell`'s command directly, `zstd` adds a prefix, and `aws`
//! keeps the bucket in a directory, answering 403 for a missing key (the
//! deploy key can't list the bucket) and 412 to a conditional create of a key
//! that exists.

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

const SOURCE_SHA: &str = "4f5c7d69c7fc685164701f4ec0a0b9b1768430a6";
const VERSION: &str = "macro-box/2026-11-25a";

fn stub(bin: &Path, name: &str, script: &str) {
    let path = bin.join(name);
    std::fs::write(
        &path,
        format!("#!/usr/bin/env bash\nset -euo pipefail\n{script}\n"),
    )
    .expect("write stub");
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).expect("executable");
}

struct Fixture {
    _temp: tempfile::TempDir,
    root: PathBuf,
    bin: PathBuf,
    bucket: PathBuf,
    log: PathBuf,
}

/// A checkout whose build makes `kernel` as vmlinux, and an empty bucket.
fn fixture(kernel: &str) -> Fixture {
    let temp = tempfile::tempdir().expect("fixture directory");
    let root = temp.path().join("checkout");
    let bin = temp.path().join("bin");
    let bucket = temp.path().join("bucket");
    for directory in [&root, &bin, &bucket] {
        std::fs::create_dir_all(directory).expect("fixture directory");
    }
    std::fs::write(temp.path().join("kvm"), "").expect("kvm stand-in");
    stub(&bin, "git", r#"echo "$SOURCE_SHA""#);
    stub(
        &bin,
        "nix",
        &format!(
            r#"case "$1" in
  build) mkdir -p result-image; printf '%s' '{kernel}' > result-image/kernel
         ln -sf kernel result-image/vmlinux
         printf 'rootfs' > result-image/rootfs.ext4; printf 'console=ttyS0' > result-image/boot_args ;;
  shell) while [ "$1" != -c ]; do shift; done; shift
         export PATH="$STUB_BIN:$PATH"; exec "$@" ;;
esac"#
        ),
    );
    stub(
        &bin,
        "zstd",
        r#"if [[ "$#" != 4 || "$4" != '-c' ]]; then exit 1; fi
printf '%s' 'compressed:'; cat"#,
    );
    stub(
        &bin,
        "aws",
        r#"printf '%s\n' "$*" >> "$STUB_AWS_LOG"
key() { local url=$1; url=${url#s3://}; echo "$STUB_BUCKET/${url#*/}"; }
if [ "$1 $2" = 's3api get-object' ]; then
  target="$STUB_BUCKET/$6"
  reads=$(grep -c '^s3api get-object ' "$STUB_AWS_LOG")
  if [ ! -f "$target" ] || { [ "${STUB_INITIAL_GET_MISSING:-}" = 1 ] && [ "$reads" -eq 1 ]; }; then
    echo 'An error occurred (AccessDenied) when calling the GetObject operation: Forbidden' >&2; exit 254
  fi
  [ -z "${STUB_READBACK_FORBIDDEN:-}" ] || { echo "An error occurred (AccessDenied) when calling the GetObject operation: Access Denied" >&2; exit 254; }
  cp "$target" "$7"; exit 0
fi
if [ "$1 $2 $3" = "s3 cp --only-show-errors" ]; then
  [ -z "${STUB_UPLOAD_FORBIDDEN:-}" ] || { echo "An error occurred (AccessDenied) when calling the UploadPart operation: Access Denied" >&2; exit 1; }
  mkdir -p "$(dirname "$(key "$5")")"; cp "$4" "$(key "$5")"
  exit 0
fi
if [ "$1 $2" = "s3api put-object" ]; then
  [ -z "${STUB_PUT_FORBIDDEN:-}" ] || { echo "An error occurred (AccessDenied) when calling the PutObject operation: Access Denied" >&2; exit 254; }
  target="$STUB_BUCKET/$6"
  [ "$9 ${10}" = '--if-none-match *' ] || exit 2
  [ ! -f "$target" ] || { printf '\nAn error occurred (PreconditionFailed) when calling the PutObject operation (412): At least one of the pre-conditions you specified did not hold\n' >&2; exit 254; }
  mkdir -p "$(dirname "$target")"; cp "$8" "$target"; exit 0
fi
exit 3"#,
    );
    Fixture {
        log: temp.path().join("aws.log"),
        _temp: temp,
        root,
        bin,
        bucket,
    }
}

fn run(fixture: &Fixture, extra: &[(&str, &str)]) -> std::process::Output {
    std::fs::write(&fixture.log, "").expect("clear aws log");
    let mut command = std::process::Command::new("bash");
    command
        .args([
            "-c",
            "export PATH=\"$STUB_BIN:$PATH\"\nexec bash \"$STUB_SCRIPT\"",
        ])
        .current_dir(&fixture.root)
        .env("STUB_BIN", &fixture.bin)
        .env(
            "STUB_SCRIPT",
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("src/workflows/scripts/firecracker_image_rollout_build.sh"),
        )
        .env("STUB_BUCKET", &fixture.bucket)
        .env("STUB_AWS_LOG", &fixture.log)
        .env(
            "KVM_DEVICE",
            fixture.bin.parent().expect("temp").join("kvm"),
        )
        .env("SOURCE_SHA", SOURCE_SHA)
        .env("IMAGE_VERSION", VERSION)
        .env("FILES_DIR", fixture.root.join("files"))
        .env("NIX_CACHE_URL", "s3://macro-nix-cache?region=us-east-1");
    for (name, value) in extra {
        command.env(name, value);
    }
    command.output().expect("run the build script")
}

fn published(fixture: &Fixture) -> Vec<String> {
    let directory = fixture.bucket.join("firecracker-images").join(VERSION);
    let mut names: Vec<String> = std::fs::read_dir(directory)
        .map(|entries| {
            entries
                .map(|entry| {
                    entry
                        .expect("entry")
                        .file_name()
                        .into_string()
                        .expect("name")
                })
                .collect()
        })
        .unwrap_or_default();
    names.sort();
    names
}

fn sha256_hex(bytes: &[u8]) -> String {
    let output = std::process::Command::new("sha256sum")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .spawn()
        .and_then(|mut child| {
            use std::io::Write;
            child.stdin.take().expect("stdin").write_all(bytes)?;
            child.wait_with_output()
        })
        .expect("sha256sum");
    String::from_utf8_lossy(&output.stdout)
        .split_whitespace()
        .next()
        .expect("digest")
        .to_owned()
}

#[test]
fn a_new_version_compresses_symlinked_input_then_creates_its_manifest() {
    let fixture = fixture("kernel-1");
    let output = run(&fixture, &[]);
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(output.status.success(), "{output:?}");
    assert!(
        stdout.contains("published macro-box/2026-11-25a"),
        "{stdout}"
    );
    let mut expected = vec![
        format!("{}-vmlinux.zst", sha256_hex(b"kernel-1")),
        format!("{}-rootfs.ext4.zst", sha256_hex(b"rootfs")),
        format!("{}-boot_args.zst", sha256_hex(b"console=ttyS0")),
        "files.json".to_owned(),
    ];
    expected.sort();
    assert_eq!(published(&fixture), expected);
    let directory = fixture.bucket.join("firecracker-images").join(VERSION);
    let kernel = directory.join(format!("{}-vmlinux.zst", sha256_hex(b"kernel-1")));
    assert_eq!(
        std::fs::read(kernel).expect("published kernel"),
        b"compressed:kernel-1"
    );
    let log = std::fs::read_to_string(&fixture.log).expect("aws log");
    assert!(log.contains("--if-none-match *"), "{log}");
    // The manifest is created after every file.
    assert!(
        log.lines().last().expect("calls").contains("put-object"),
        "{log}"
    );
}

#[test]
fn the_same_build_again_finds_its_version_published_with_these_files() {
    let fixture = fixture("kernel-1");
    assert!(run(&fixture, &[]).status.success());
    let output = run(&fixture, &[("STUB_INITIAL_GET_MISSING", "1")]);
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(output.status.success(), "{output:?}");
    assert!(
        stdout.contains("already published with these files"),
        "{stdout}"
    );
}

#[test]
fn a_different_build_of_a_published_version_is_refused() {
    let fixture = fixture("kernel-1");
    assert!(run(&fixture, &[]).status.success());
    let manifest = fixture
        .bucket
        .join("firecracker-images")
        .join(VERSION)
        .join("files.json");
    let before = std::fs::read(&manifest).expect("manifest");
    std::fs::remove_dir_all(fixture.root.join("result-image")).expect("clean build");
    stub(
        &fixture.bin,
        "nix",
        r#"case "$1" in
  build) mkdir -p result-image; printf 'kernel-2' > result-image/vmlinux
         printf 'rootfs' > result-image/rootfs.ext4; printf 'console=ttyS0' > result-image/boot_args ;;
  shell) while [ "$1" != -c ]; do shift; done; shift
         export PATH="$STUB_BIN:$PATH"; exec "$@" ;;
esac"#,
    );

    let output = run(&fixture, &[("STUB_INITIAL_GET_MISSING", "1")]);
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(!output.status.success(), "{stdout}");
    assert!(
        stdout.contains("already published with other files"),
        "{stdout}"
    );
    // The published manifest still names the first build's files.
    assert_eq!(std::fs::read(&manifest).expect("manifest"), before);
}

#[test]
fn a_refused_publish_says_what_aws_answered() {
    let fixture = fixture("kernel-1");
    let output = run(&fixture, &[("STUB_PUT_FORBIDDEN", "1")]);
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(!output.status.success(), "{stdout}");
    assert!(stdout.contains("AWS said:"), "{stdout}");
    assert!(stdout.contains("Access Denied"), "{stdout}");
    assert!(!published(&fixture).contains(&"files.json".to_owned()));
}

#[test]
fn a_published_manifest_that_cannot_be_read_fails_the_retry() {
    let fixture = fixture("kernel-1");
    assert!(run(&fixture, &[]).status.success());

    let output = run(
        &fixture,
        &[
            ("STUB_INITIAL_GET_MISSING", "1"),
            ("STUB_READBACK_FORBIDDEN", "1"),
        ],
    );
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(!output.status.success(), "{stdout}");
    assert!(
        stdout.contains("GetObject operation: Access Denied"),
        "{stdout}"
    );
    assert!(
        stdout.contains("is published but its files.json can't be read"),
        "{stdout}"
    );
}

#[test]
fn a_failed_object_upload_does_not_publish_a_manifest() {
    let fixture = fixture("kernel-1");
    let output = run(&fixture, &[("STUB_UPLOAD_FORBIDDEN", "1")]);
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(!output.status.success(), "{stdout}");
    assert!(
        stdout.contains("UploadPart operation: Access Denied"),
        "{stdout}"
    );
    assert!(stdout.contains("uploading vmlinux failed"), "{stdout}");
    let log = std::fs::read_to_string(&fixture.log).expect("aws log");
    assert!(!log.contains("put-object"), "{log}");
}

#[test]
fn reuses_the_published_manifest_without_building_or_uploading() {
    let fixture = fixture("kernel-1");
    assert!(run(&fixture, &[]).status.success());
    std::fs::remove_dir_all(fixture.root.join("result-image")).expect("clean build");
    let manifest = fixture.root.join("files/files.json");
    let before = std::fs::read(&manifest).expect("first manifest");
    std::fs::remove_file(&manifest).expect("clean manifest");

    let output = run(&fixture, &[]);
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(output.status.success(), "{output:?}");
    assert!(stdout.contains("reusing macro-box/2026-11-25a"), "{stdout}");
    assert!(!fixture.root.join("result-image").exists());
    assert_eq!(std::fs::read(manifest).expect("reused manifest"), before);
    let log = std::fs::read_to_string(&fixture.log).expect("aws log");
    assert_eq!(log.lines().count(), 1, "{log}");
    assert!(log.starts_with("s3api get-object "), "{log}");
}

#[test]
fn rejects_a_published_version_from_another_commit() {
    let fixture = fixture("kernel-1");
    assert!(run(&fixture, &[]).status.success());
    std::fs::remove_dir_all(fixture.root.join("result-image")).expect("clean build");

    let output = run(
        &fixture,
        &[("SOURCE_SHA", "0000000000000000000000000000000000000001")],
    );
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(!output.status.success(), "{stdout}");
    assert!(
        stdout.contains("has a different published source commit"),
        "{stdout}"
    );
    assert!(!fixture.root.join("result-image").exists());
}

#[test]
fn rejects_invalid_file_metadata_in_a_published_manifest() {
    let fixture = fixture("kernel-1");
    assert!(run(&fixture, &[]).status.success());
    let path = fixture
        .bucket
        .join("firecracker-images")
        .join(VERSION)
        .join("files.json");
    let valid: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&path).expect("manifest")).expect("parse manifest");

    for (field, value) in [
        ("name", serde_json::json!("unexpected")),
        ("sha256", serde_json::json!("1234")),
        ("bytes", serde_json::json!(0)),
    ] {
        let mut invalid = valid.clone();
        invalid["files"][0][field] = value;
        std::fs::write(
            &path,
            serde_json::to_vec(&invalid).expect("serialize manifest"),
        )
        .expect("write manifest");

        let output = run(&fixture, &[]);
        let stdout = String::from_utf8_lossy(&output.stdout);
        assert!(!output.status.success(), "{field}: {stdout}");
        assert!(
            stdout.contains("has an invalid published manifest"),
            "{field}: {stdout}"
        );
    }
}

fn run_migrator(root: &Path, digest: Option<&str>) -> std::process::Output {
    let mut command = std::process::Command::new("bash");
    command
        .args([
            "-c",
            "export PATH=\"$STUB_BIN:$PATH\"\nexec bash \"$STUB_SCRIPT\"",
        ])
        .env_remove("BASH_ENV")
        .env_remove("CLI_SHA256")
        .env("STUB_BIN", root)
        .env(
            "STUB_SCRIPT",
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("src/workflows/scripts/firecracker_image_rollout_run.sh"),
        )
        .env("ENVIRONMENT", "dev")
        .env("CLI_DIR", root)
        .env("FILES_DIR", root)
        .env("RUNNER_TEMP", root)
        .env("GITHUB_STEP_SUMMARY", root.join("summary"))
        .env("NIX_CACHE_URL", "s3://fixture-bucket?region=us-east-1")
        .env("AWS_ACCESS_KEY_ID", "fixture-key")
        .env("AWS_SECRET_ACCESS_KEY", "fixture-secret")
        .env("SOURCE_SHA", SOURCE_SHA)
        .env("IMAGE_VERSION", VERSION)
        .env("COMPUTERS", "00000000-0000-0000-0000-000000000001")
        .env("BATCH_SIZE", "1")
        .env("IDLE_WAIT_MINUTES", "30")
        .env("RECONNECT_TIMEOUT_MINUTES", "10")
        .env("RUN_URL", "https://example.invalid/run/1");
    if let Some(digest) = digest {
        command.env("CLI_SHA256", digest);
    }
    command.output().expect("run the migrator script")
}

#[test]
fn the_migrator_rejects_a_missing_malformed_or_mismatched_digest() {
    let temp = tempfile::tempdir().expect("fixture directory");
    std::fs::write(temp.path().join("image-upgrade"), "other bytes").expect("write binary");
    let mismatch = sha256_hex(b"original bytes");

    for (digest, message) in [
        (None, "the rollout CLI checksum is missing or invalid"),
        (
            Some("xyz"),
            "the rollout CLI checksum is missing or invalid",
        ),
        (
            Some(mismatch.as_str()),
            "the rollout CLI checksum could not be verified",
        ),
    ] {
        let output = run_migrator(temp.path(), digest);
        assert!(!output.status.success(), "{output:?}");
        assert!(
            String::from_utf8_lossy(&output.stdout).contains(message),
            "{output:?}"
        );
    }
}

#[test]
fn the_migrator_runs_the_verified_cli_without_bucket_credentials() {
    let temp = tempfile::tempdir().expect("fixture directory");
    stub(
        temp.path(),
        "aws",
        r#"
case "$1" in
  s3) [[ "$2" == presign && -v AWS_ACCESS_KEY_ID && -v AWS_SECRET_ACCESS_KEY ]];
      echo 'https://example.invalid/image.zst' ;;
  secretsmanager) [[ ! -v AWS_ACCESS_KEY_ID && ! -v AWS_SECRET_ACCESS_KEY ]];
                  echo 'postgres://example.invalid/test' ;;
  *) exit 1 ;;
esac"#,
    );
    stub(
        temp.path(),
        "image-upgrade",
        r#"
[[ ! -v AWS_ACCESS_KEY_ID && ! -v AWS_SECRET_ACCESS_KEY ]]
case "$1" in
  start) echo 'upgrade-id' ;;
  wait) echo 'rollout completed' ;;
  *) exit 1 ;;
esac"#,
    );
    let kernel_sha = "1".repeat(64);
    let files: Vec<_> = ["vmlinux", "rootfs.ext4", "boot_args"]
        .into_iter()
        .map(|name| serde_json::json!({"name": name, "sha256": kernel_sha, "bytes": 1}))
        .collect();
    let manifest = serde_json::json!({"source_sha": SOURCE_SHA, "files": files});
    std::fs::write(temp.path().join("files.json"), manifest.to_string()).expect("write manifest");
    let binary = temp.path().join("image-upgrade");
    let digest = sha256_hex(&std::fs::read(&binary).expect("read binary fixture"));
    std::fs::set_permissions(binary, std::fs::Permissions::from_mode(0o644))
        .expect("strip the executable bit as artifact download does");

    let output = run_migrator(temp.path(), Some(&digest));
    assert!(output.status.success(), "{output:?}");
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("upgrade upgrade-id recorded"), "{stdout}");
    assert!(stdout.contains("rollout completed"), "{stdout}");
}

#[test]
fn the_workflow_builds_the_cli_before_publish_and_runs_it_without_cargo_on_the_migrator() {
    let yaml = super::firecracker_image_rollout()
        .to_string()
        .expect("render rollout workflow");
    let build_step = yaml
        .find("name: Build the rollout CLI")
        .expect("build CLI step");
    let publish_step = yaml
        .find("name: Build, hash and publish the image")
        .expect("publish step");
    assert!(build_step < publish_step);

    let rollout = yaml.split("\n  roll-out:\n").nth(1).expect("rollout job");
    assert!(rollout.contains("CLI_SHA256: ${{ needs.build.outputs.cli_sha256 }}"));
    assert!(rollout.contains("name: Download Rollout CLI"));
    assert!(!rollout.contains("actions/checkout@"));
    assert!(!rollout.contains("cargo "));
}
