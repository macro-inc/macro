use super::*;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::process::{Command, Output};

const RELEASE_TAG: &str = "v2026.10.16.0";
const RELEASE_VERSION: &str = "2026.1016.0";
const RELEASE_SHA: &str = "0123456789abcdef0123456789abcdef01234567";

struct PublishFixture {
    temp: tempfile::TempDir,
    channel_version: &'static str,
}

impl PublishFixture {
    fn new(channel_version: &'static str) -> Self {
        let temp = tempfile::tempdir().expect("publish fixture directory");
        let bin = temp.path().join("bin");
        fs::create_dir(&bin).expect("mock command directory");
        let artifacts = temp.path().join("release-artifacts");
        fs::create_dir(&artifacts).expect("release artifacts directory");
        fs::write(artifacts.join("installer.bin"), "installer").expect("installer artifact");

        write_command(
            &bin,
            "git",
            r#"#!/usr/bin/env bash
set -euo pipefail
[[ "$1" == rev-parse ]]
printf '%s\n' "$STUB_RELEASE_SHA"
"#,
        );
        write_command(
            &bin,
            "nix",
            r#"#!/usr/bin/env bash
set -euo pipefail
[[ "$1" == develop && "$2" == --command && "$3" == bun && "$4" == apps/web/scripts/desktop-release.mjs ]]
command=$5
shift 5
case "$command" in
  manifest)
    printf '{"version":"%s"}\n' "$STUB_RELEASE_VERSION" > "$1/latest.json"
    ;;
  newer)
    IFS=. read -r candidate_major candidate_minor candidate_patch <<< "$(jq -r .version "$1")"
    IFS=. read -r current_major current_minor current_patch <<< "$(jq -r .version "$2")"
    if (( candidate_major > current_major ||
          (candidate_major == current_major && candidate_minor > current_minor) ||
          (candidate_major == current_major && candidate_minor == current_minor && candidate_patch > current_patch) )); then
      exit 0
    fi
    exit 2
    ;;
  *) exit 2 ;;
esac
"#,
        );
        write_command(
            &bin,
            "gh",
            r#"#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$STUB_GH_LOG"
case "$1 $2" in
  'release view')
    if [[ "$3" == desktop-stable ]]; then
      [[ -n "$STUB_CHANNEL_VERSION" ]] || exit 1
      printf '{"assets":[{"name":"latest.json"}]}\n'
    elif [[ "$3" == "$STUB_RELEASE_TAG" ]]; then
      printf '{"assets":[]}\n'
    else
      exit 2
    fi
    ;;
  'release download')
    [[ "$3" == desktop-stable && -n "$STUB_CHANNEL_VERSION" ]]
    while (( $# > 0 )); do
      if [[ "$1" == --dir ]]; then
        printf '{"version":"%s"}\n' "$STUB_CHANNEL_VERSION" > "$2/latest.json"
        exit 0
      fi
      shift
    done
    exit 2
    ;;
  'release create')
    [[ "$3" == desktop-stable ]] || exit 2
    target=''
    while (( $# > 0 )); do
      if [[ "$1" == --target ]]; then
        target=$2
        break
      fi
      shift
    done
    [[ "$target" == "$STUB_RELEASE_SHA" ]] || {
      printf 'desktop-stable target must be the release commit SHA, got %s\n' "$target" >&2
      exit 2
    }
    ;;
  'release upload'|'release edit') ;;
  'api --paginate') printf '[]\n' ;;
  *) exit 2 ;;
esac
"#,
        );

        Self {
            temp,
            channel_version,
        }
    }

    fn run(&self) -> Output {
        let root = self.temp.path();
        Command::new("bash")
            .args([
                "-c",
                "export PATH=\"$STUB_BIN:$PATH\"\nexec bash \"$STUB_SCRIPT\"",
            ])
            .current_dir(root)
            .env("STUB_BIN", root.join("bin"))
            .env(
                "STUB_SCRIPT",
                Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join("src/workflows/scripts/publish_desktop_updates.sh"),
            )
            .env("STUB_GH_LOG", root.join("gh.log"))
            .env("STUB_RELEASE_TAG", RELEASE_TAG)
            .env("STUB_RELEASE_VERSION", RELEASE_VERSION)
            .env("STUB_RELEASE_SHA", RELEASE_SHA)
            .env("STUB_CHANNEL_VERSION", self.channel_version)
            .env("RELEASE_TAG", RELEASE_TAG)
            .env("RELEASE_REPOSITORY", "macro-inc/macro")
            .output()
            .expect("run desktop update publication script")
    }

    fn gh_calls(&self) -> String {
        fs::read_to_string(self.temp.path().join("gh.log")).expect("GitHub command log")
    }
}

fn write_command(bin: &Path, name: &str, contents: &str) {
    let path = bin.join(name);
    fs::write(&path, contents).expect("mock command");
    fs::set_permissions(path, fs::Permissions::from_mode(0o755)).expect("executable mock");
}

fn assert_publish_success(output: &Output) {
    assert!(
        output.status.success(),
        "publish failed: {:?}\nstdout: {}\nstderr: {}",
        output.status,
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr),
    );
}

fn called(calls: &str, prefix: &str) -> bool {
    calls.lines().any(|line| line.starts_with(prefix))
}

fn rendered_yaml() -> String {
    build_desktop_on_tag()
        .to_string()
        .expect("desktop workflow should serialize")
}

#[test]
fn desktop_release_uses_larger_isolated_runners() {
    let yaml = rendered_yaml();
    assert!(
        yaml.contains("namespace-profile-linux-mid;overrides.cache-tag=desktop-linux"),
        "{yaml}"
    );
    assert!(
        yaml.contains("nscloud-macos-sequoia-arm64-12x28-with-cache"),
        "{yaml}"
    );
    assert!(yaml.contains("nscloud-cache-tag-macro-desktop-macos"));
}

#[test]
fn installers_publish_without_waiting_on_updater_signing() {
    let yaml = rendered_yaml();
    let installers = yaml
        .find("  publish-installers:")
        .expect("installer publish job");
    let updates = yaml
        .find("  publish-release:")
        .expect("updater publish job");

    // Both builds gate the installer upload, and nothing else does: a Doppler,
    // Apple, or update-feed failure must still leave a downloadable release.
    let installer_job = &yaml[installers..updates];
    assert!(
        installer_job.contains("- build-appimage"),
        "{installer_job}"
    );
    assert!(installer_job.contains("- build-dmg"), "{installer_job}");
    assert!(
        !installer_job.contains("sign_desktop_updates") && !installer_job.contains("DOPPLER_TOKEN"),
        "installer publication must not depend on updater signing:\n{installer_job}"
    );
}

#[test]
fn updater_publish_follows_the_installers() {
    let yaml = rendered_yaml();
    let updates = yaml
        .find("  publish-release:")
        .expect("updater publish job");
    // Serialized behind the installer upload so the two never race to attach
    // the same asset, which `gh release upload` rejects without --clobber.
    assert!(
        yaml[updates..].contains("- publish-installers"),
        "{}",
        &yaml[updates..]
    );
}

#[test]
fn hosted_publish_runner_skips_the_nix_cache_teardown() {
    let yaml = rendered_yaml();
    let updates = yaml
        .find("  publish-release:")
        .expect("updater publish job");
    // `fuser -km /nix` kills the runner itself where /nix is the root
    // filesystem, losing the job and its logs. Only cache-volume jobs tear down.
    assert!(
        !yaml[updates..].contains("teardown-nix"),
        "{}",
        &yaml[updates..]
    );
    assert!(yaml[updates..].contains("timeout-minutes: 20"));
}

#[test]
fn first_update_creates_channel_at_release_commit_and_promotes_release() {
    let fixture = PublishFixture::new("");
    assert_publish_success(&fixture.run());
    let calls = fixture.gh_calls();
    assert!(
        calls.lines().any(|line| {
            line.starts_with("release create desktop-stable ")
                && line.contains(&format!("--target {RELEASE_SHA}"))
        }),
        "channel must point at the release commit: {calls}"
    );
    assert!(called(&calls, "release upload desktop-stable "), "{calls}");
    assert!(
        calls.lines().any(|line| {
            line.starts_with(&format!("release edit {RELEASE_TAG} ")) && line.contains("--latest")
        }),
        "new releases must become the latest download: {calls}"
    );
}

#[test]
fn equal_version_rerun_finishes_marking_release_latest() {
    let fixture = PublishFixture::new(RELEASE_VERSION);
    assert_publish_success(&fixture.run());
    let calls = fixture.gh_calls();
    assert!(!called(&calls, "release create desktop-stable "), "{calls}");
    assert!(!called(&calls, "release upload desktop-stable "), "{calls}");
    assert!(
        calls.lines().any(|line| {
            line.starts_with(&format!("release edit {RELEASE_TAG} ")) && line.contains("--latest")
        }),
        "equal-version reruns must finish release promotion: {calls}"
    );
}

#[test]
fn older_release_cannot_replace_update_feed_or_latest_release() {
    let fixture = PublishFixture::new("2026.1017.0");
    assert_publish_success(&fixture.run());
    let calls = fixture.gh_calls();
    assert!(!called(&calls, "release create desktop-stable "), "{calls}");
    assert!(!called(&calls, "release upload desktop-stable "), "{calls}");
    assert!(
        !called(&calls, &format!("release edit {RELEASE_TAG} ")),
        "{calls}"
    );
}
