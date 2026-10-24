use super::*;
use serde_yaml::Value;
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
    render().expect("desktop workflow should serialize")
}

fn rendered_jobs() -> serde_yaml::Mapping {
    let root: Value = serde_yaml::from_str(&rendered_yaml()).expect("desktop workflow YAML");
    root.get("jobs")
        .and_then(Value::as_mapping)
        .expect("desktop workflow jobs")
        .clone()
}

fn job<'a>(jobs: &'a serde_yaml::Mapping, id: &str) -> &'a Value {
    jobs.get(id).unwrap_or_else(|| panic!("job {id}"))
}

fn condition(value: &Value) -> &str {
    value.get("if").and_then(Value::as_str).unwrap_or("")
}

fn script_path(name: &str) -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("src/workflows/scripts")
        .join(name)
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

#[test]
fn pull_request_builds_never_sign_notarize_cache_or_upload() {
    let jobs = rendered_jobs();
    for build in ["build-appimage", "build-dmg"] {
        let steps = job(&jobs, build)
            .get("steps")
            .and_then(Value::as_sequence)
            .expect("build steps");
        for step in steps {
            let rendered = serde_yaml::to_string(step).expect("step YAML");
            // The bundle inlines the public PostHog key; every other secret signs,
            // notarizes, or publishes.
            let release_only = rendered.contains("MACOS_")
                || rendered.contains("DOPPLER_TOKEN")
                || rendered.contains("upload-artifact")
                || rendered.contains("save_macos_nix_cache")
                || rendered.contains("Prune and save macOS Nix");
            if release_only {
                assert!(
                    condition(step).contains("github.event_name != 'pull_request'"),
                    "{build} step must not run on pull requests:\n{rendered}"
                );
            }
        }
    }
    assert!(
        condition(job(&jobs, "publish-installers")).contains("github.event_name != 'pull_request'")
    );
    assert!(
        condition(job(&jobs, "publish-release"))
            .contains("startsWith(needs.resolve-ref.outputs.ref, 'refs/tags/v')")
    );
}

#[test]
fn release_secret_check_covers_every_secret_the_other_jobs_read() {
    let jobs = rendered_jobs();
    let mut read = BTreeSet::new();
    for (id, job) in &jobs {
        if id.as_str() == Some("check-release-secrets") {
            continue;
        }
        let rendered = serde_yaml::to_string(job).expect("job YAML");
        read.extend(secrets_read_by(&rendered).into_iter().map(str::to_owned));
    }
    // The secret whose absence failed v2026.10.22.3 after its PR merged green.
    assert!(read.contains("MACOS_DEVELOPER_ID_PROVISIONING_PROFILE_BASE64"));

    let env = job(&jobs, "check-release-secrets")["steps"][0]["env"].clone();
    let checked: BTreeSet<String> = env["RELEASE_SECRETS"]
        .as_str()
        .expect("RELEASE_SECRETS")
        .split(' ')
        .map(str::to_owned)
        .collect();
    assert_eq!(checked, read);
    for name in &checked {
        assert_eq!(
            env[name.as_str()].as_str(),
            Some(format!("${{{{ secrets.{name} }}}}").as_str()),
            "{name} must reach the check"
        );
    }
}

fn run_secret_check(configured: &[(&str, &str)]) -> Output {
    let mut command = Command::new("bash");
    command
        .arg(script_path("check_release_secrets.sh"))
        .env_clear()
        .env("PATH", std::env::var("PATH").expect("PATH"))
        .env(
            "RELEASE_SECRETS",
            "POSTHOG_API_KEY MACOS_RELEASE_DOPPLER_TOKEN",
        );
    for (name, value) in configured {
        command.env(name, value);
    }
    command.output().expect("run release secret check")
}

#[test]
fn secret_check_names_each_unconfigured_secret() {
    let output = run_secret_check(&[
        ("POSTHOG_API_KEY", "phc_test"),
        ("MACOS_RELEASE_DOPPLER_TOKEN", ""),
    ]);
    assert!(!output.status.success());
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(
        stdout.contains("::error::Repository secret MACOS_RELEASE_DOPPLER_TOKEN is not configured"),
        "{stdout}"
    );
    assert!(!stdout.contains("secret POSTHOG_API_KEY"), "{stdout}");
}

#[test]
fn secret_check_passes_when_every_secret_is_configured() {
    let output = run_secret_check(&[
        ("POSTHOG_API_KEY", "phc_test"),
        ("MACOS_RELEASE_DOPPLER_TOKEN", "dp.st.test"),
    ]);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stdout)
    );
}

fn resolve_ref(event: &str, selected_ref: &str, input_ref: &str) -> (Output, String) {
    let temp = tempfile::tempdir().expect("resolve fixture directory");
    let github_output = temp.path().join("github-output");
    let output = Command::new("bash")
        .arg(script_path("resolve_desktop_ref.sh"))
        .env("EVENT_NAME", event)
        .env("SELECTED_REF", selected_ref)
        .env("INPUT_REF", input_ref)
        .env("GITHUB_EVENT_REF", "")
        .env("GITHUB_EVENT_REF_TYPE", "")
        .env("GITHUB_OUTPUT", &github_output)
        .output()
        .expect("run desktop ref resolution");
    (
        output,
        fs::read_to_string(github_output).unwrap_or_default(),
    )
}

#[test]
fn pull_requests_and_the_nightly_build_their_own_ref() {
    let (output, resolved) = resolve_ref("pull_request", "refs/pull/8600/merge", "");
    assert!(output.status.success());
    assert_eq!(resolved, "ref=refs/pull/8600/merge\n");

    let (output, resolved) = resolve_ref("schedule", "refs/heads/main", "");
    assert!(output.status.success());
    assert_eq!(resolved, "ref=refs/heads/main\n");
}

#[test]
fn manual_overrides_still_only_accept_release_tags() {
    let (output, resolved) = resolve_ref("workflow_dispatch", "refs/heads/main", "main");
    assert!(!output.status.success());
    assert_eq!(resolved, "");
}
