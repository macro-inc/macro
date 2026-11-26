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
    /// The `latest.json` this release builds, and the one already promoted,
    /// when a test needs more than their versions.
    feeds: Option<(&'static str, &'static str)>,
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
    if [[ -n "${STUB_MANIFEST:-}" ]]; then
      printf '%s\n' "$STUB_MANIFEST" > "$1/latest.json"
    else
      printf '{"version":"%s"}\n' "$STUB_RELEASE_VERSION" > "$1/latest.json"
    fi
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
        if [[ -n "${STUB_CHANNEL_FEED:-}" ]]; then
          printf '%s\n' "$STUB_CHANNEL_FEED" > "$2/latest.json"
        else
          printf '{"version":"%s"}\n' "$STUB_CHANNEL_VERSION" > "$2/latest.json"
        fi
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
            feeds: None,
        }
    }

    fn with_feeds(mut self, candidate: &'static str, current: &'static str) -> Self {
        self.feeds = Some((candidate, current));
        self
    }

    fn run(&self) -> Output {
        let root = self.temp.path();
        let (manifest, channel_feed) = self.feeds.unwrap_or(("", ""));
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
            .env("STUB_MANIFEST", manifest)
            .env("STUB_CHANNEL_FEED", channel_feed)
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

/// The text of one job, from its key to the next job's key.
fn job_yaml<'a>(yaml: &'a str, key: &str) -> &'a str {
    let header = format!("\n  {key}:\n");
    let start = yaml
        .find(&header)
        .unwrap_or_else(|| panic!("job {key} in:\n{yaml}"))
        + 1;
    let body = start + header.len() - 1;
    let mut end = body;
    for line in yaml[body..].split_inclusive('\n') {
        // A job key is the only line indented by exactly two spaces.
        let next_job = line.starts_with("  ")
            && line
                .as_bytes()
                .get(2)
                .is_some_and(|byte| !byte.is_ascii_whitespace());
        if next_job {
            break;
        }
        end += line.len();
    }
    &yaml[start..end]
}

#[test]
fn promotion_waits_for_macos_release_qa() {
    let yaml = rendered_yaml();
    let updates = job_yaml(&yaml, "publish-release");
    assert!(updates.contains("- qa-macos"), "{updates}");

    // QA gates the update feed only: the versioned release still gets installers.
    let installers = job_yaml(&yaml, "publish-installers");
    assert!(!installers.contains("qa-macos"), "{installers}");
}

#[test]
fn macos_release_qa_tests_the_signed_dmg() {
    let yaml = rendered_yaml();
    let qa = job_yaml(&yaml, "qa-macos");
    assert!(qa.contains("name: QA macOS release app"), "{qa}");
    assert!(qa.contains("- build-dmg"), "{qa}");
    assert!(
        qa.contains("name: macro-dmg-${{ steps.metadata.outputs.safe_tag }}"),
        "{qa}"
    );
    assert!(qa.contains("echo \"QA_DMG="), "{qa}");
    assert!(qa.contains("QA_ATTEMPTS: '2'"), "{qa}");
    assert!(qa.contains("QA_SUITE: smoke"), "{qa}");
    // The release app embeds the production PostHog key.
    assert!(qa.contains("Block analytics for the QA launch"), "{qa}");
    let block = qa.find("Block analytics").expect("analytics block step");
    let launch = qa
        .find("Launch the app and run the QA checks")
        .expect("harness step");
    assert!(
        block < launch,
        "analytics must be blocked before the launch:\n{qa}"
    );
    // Not `macro-*`, which the publish jobs attach to the release.
    assert!(
        qa.contains("name: macos-qa-release-${{ github.run_id }}-${{ github.run_attempt }}"),
        "{qa}"
    );
}

#[test]
fn publish_jobs_download_only_build_artifacts() {
    let yaml = rendered_yaml();
    for key in ["publish-installers", "publish-release"] {
        let job = job_yaml(&yaml, key);
        assert!(job.contains("pattern: macro-*"), "{job}");
    }
}

#[test]
fn failed_release_qa_alerts() {
    let script = include_str!("../scripts/alert_native_build_failures.sh");
    assert!(
        script.contains(&format!(
            "\"{}\"",
            crate::workflows::desktop_qa_macos::QA_RELEASE_JOB_NAME
        )),
        "{script}"
    );
}

#[test]
fn intel_dmg_cross_compiles_beside_apple_silicon_on_its_own_cache() {
    let yaml = rendered_yaml();
    let intel = job_yaml(&yaml, "build-dmg-x86_64");
    assert!(
        intel.contains("nscloud-macos-sequoia-arm64-12x28-with-cache"),
        "{intel}"
    );
    assert!(
        intel.contains("nscloud-cache-tag-macro-desktop-macos-x86_64"),
        "{intel}"
    );
    assert!(
        intel.contains("DESKTOP_DMG_PACKAGE: tauri-desktop-dmg-x86_64"),
        "{intel}"
    );
    assert!(intel.contains("DESKTOP_MACH_O_ARCH: x86_64"), "{intel}");
    assert!(intel.contains("name: macro-dmg-x86_64-"), "{intel}");
    assert!(intel.contains("timeout-minutes: 180"), "{intel}");
    assert!(
        intel.contains("if: needs.resolve-ref.outputs.intel == 'true'"),
        "{intel}"
    );

    let arm = job_yaml(&yaml, "build-dmg");
    assert!(
        arm.contains("nscloud-cache-tag-macro-desktop-macos\n"),
        "{arm}"
    );
    assert!(
        arm.contains("DESKTOP_DMG_PACKAGE: tauri-desktop-dmg\n"),
        "{arm}"
    );
    assert!(arm.contains("DESKTOP_MACH_O_ARCH: arm64"), "{arm}");
    assert!(!arm.contains("\n    if:"), "{arm}");
}

#[test]
fn a_failed_or_skipped_intel_build_still_publishes_the_others() {
    let yaml = rendered_yaml();
    let installers = job_yaml(&yaml, "publish-installers");
    assert!(installers.contains("- build-dmg-x86_64"), "{installers}");
    let condition = installers
        .lines()
        .find(|line| line.trim_start().starts_with("if:"))
        .unwrap_or_else(|| panic!("publish-installers needs a condition:\n{installers}"));
    assert!(condition.contains("!cancelled()"), "{condition}");
    for job in ["resolve-ref", "build-appimage", "build-dmg"] {
        assert!(
            condition.contains(&format!("needs.{job}.result == ''success''")),
            "{condition}"
        );
    }
    assert!(!condition.contains("build-dmg-x86_64"), "{condition}");

    // With no condition of its own, the update feed job would be skipped
    // whenever the Intel build is, since the default success() reads the chain.
    let updates = job_yaml(&yaml, "publish-release");
    assert!(
        updates.contains("needs.publish-installers.result == ''success''"),
        "{updates}"
    );
    // Its own condition must keep the QA gate the default success() gave it.
    assert!(
        updates.contains("needs.qa-macos.result == ''success''"),
        "{updates}"
    );
}

struct IntelDecision {
    temp: tempfile::TempDir,
}

impl IntelDecision {
    /// `manifest` is what `gh api` prints for cef-codecs.json; `None` fails it.
    fn new(manifest: Option<&str>) -> Self {
        let temp = tempfile::tempdir().expect("decision fixture directory");
        let bin = temp.path().join("bin");
        fs::create_dir(&bin).expect("mock command directory");
        let gh = match manifest {
            Some(manifest) => format!(
                "#!/usr/bin/env bash\nprintf '%s\\n' \"$*\" >> \"$STUB_GH_LOG\"\ncat <<'JSON'\n{manifest}\nJSON\n"
            ),
            None => "#!/usr/bin/env bash\nprintf '%s\\n' \"$*\" >> \"$STUB_GH_LOG\"\necho 'HTTP 502' >&2\nexit 1\n".to_owned(),
        };
        write_command(&bin, "gh", &gh);
        Self { temp }
    }

    /// `gh api` that answers nothing until long after the read's deadline.
    fn stalled() -> Self {
        let temp = tempfile::tempdir().expect("decision fixture directory");
        let bin = temp.path().join("bin");
        fs::create_dir(&bin).expect("mock command directory");
        write_command(
            &bin,
            "gh",
            "#!/usr/bin/env bash\nprintf '%s\\n' \"$*\" >> \"$STUB_GH_LOG\"\nexec sleep 60\n",
        );
        Self { temp }
    }

    fn decide(&self, build_ref: &str) -> String {
        let root = self.temp.path();
        let output_file = root.join("output");
        fs::write(&output_file, "").expect("output file");
        let output = Command::new("bash")
            .args([
                "-c",
                "export PATH=\"$STUB_BIN:$PATH\"\nexec bash \"$STUB_SCRIPT\"",
            ])
            .current_dir(root)
            .env("STUB_BIN", root.join("bin"))
            .env(
                "STUB_SCRIPT",
                Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join("src/workflows/scripts/decide_intel_desktop.sh"),
            )
            .env("STUB_GH_LOG", root.join("gh.log"))
            .env("GITHUB_OUTPUT", &output_file)
            .env("GITHUB_REPOSITORY", "macro-inc/macro")
            .env("BUILD_REF", build_ref)
            .env("READ_RETRY_SECONDS", "0")
            .env("READ_TIMEOUT_SECONDS", "1")
            .output()
            .expect("run the Intel decision script");
        assert_publish_success(&output);
        fs::read_to_string(output_file).expect("step output")
    }

    fn gh_calls(&self) -> String {
        fs::read_to_string(self.temp.path().join("gh.log")).unwrap_or_default()
    }
}

const ARM_ONLY_MANIFEST: &str = r#"{"assets":{"aarch64":{"asset":"a.tar.bz2","sha256":"aa"}}}"#;
const PENDING_INTEL_MANIFEST: &str = r#"{"assets":{"aarch64":{"asset":"a.tar.bz2","sha256":"aa"},"x86_64":{"asset":"x.tar.bz2","sha256":""}}}"#;
const PINNED_INTEL_MANIFEST: &str = r#"{"assets":{"aarch64":{"asset":"a.tar.bz2","sha256":"aa"},"x86_64":{"asset":"x.tar.bz2","sha256":"bb"}}}"#;

#[test]
fn release_tags_build_intel_only_once_its_codec_cef_is_pinned() {
    let tag = "refs/tags/v2026.11.24.0";
    assert_eq!(
        IntelDecision::new(Some(ARM_ONLY_MANIFEST)).decide(tag),
        "intel=false\n"
    );
    assert_eq!(
        IntelDecision::new(Some(PENDING_INTEL_MANIFEST)).decide(tag),
        "intel=false\n"
    );
    let pinned = IntelDecision::new(Some(PINNED_INTEL_MANIFEST));
    assert_eq!(pinned.decide(tag), "intel=true\n");
    assert!(
        pinned.gh_calls().contains(&format!(
            "repos/macro-inc/macro/contents/apps/web/tauri/desktop-cef/cef-codecs.json?ref={tag}"
        )),
        "{}",
        pinned.gh_calls()
    );
}

#[test]
fn an_unreadable_manifest_skips_intel_instead_of_failing_the_release() {
    let unreachable = IntelDecision::new(None);
    assert_eq!(
        unreachable.decide("refs/tags/v2026.11.24.0"),
        "intel=false\n"
    );
    assert_eq!(
        unreachable.gh_calls().lines().count(),
        3,
        "retries before skipping"
    );
    assert_eq!(
        IntelDecision::new(Some("not json")).decide("refs/tags/v2026.11.24.0"),
        "intel=false\n"
    );
}

#[test]
fn a_stalled_manifest_read_times_out_and_skips_intel() {
    let stalled = IntelDecision::stalled();
    let started = std::time::Instant::now();
    assert_eq!(stalled.decide("refs/tags/v2026.11.24.0"), "intel=false\n");
    assert_eq!(
        stalled.gh_calls().lines().count(),
        3,
        "each attempt times out"
    );
    assert!(
        started.elapsed() < std::time::Duration::from_secs(30),
        "the reads must not wait for the stalled response"
    );
}

#[test]
fn branch_builds_always_verify_intel_without_reading_the_manifest() {
    let decision = IntelDecision::new(None);
    assert_eq!(decision.decide("refs/heads/some-branch"), "intel=true\n");
    assert_eq!(decision.gh_calls(), "");
}

const FEED_WITHOUT_INTEL: &str = r#"{"version":"2026.1016.0","notes":"Macro v2026.10.16.0","platforms":{"darwin-aarch64":{"url":"a","signature":"sa"},"linux-x86_64":{"url":"l","signature":"sl"}}}"#;
const FEED_WITH_INTEL: &str = r#"{"version":"2026.1016.0","notes":"Macro v2026.10.16.0","platforms":{"darwin-aarch64":{"url":"a","signature":"sa"},"darwin-x86_64":{"url":"x","signature":"sx"},"linux-x86_64":{"url":"l","signature":"sl"}}}"#;
const FEED_WITH_CHANGED_ARM: &str = r#"{"version":"2026.1016.0","notes":"Macro v2026.10.16.0","platforms":{"darwin-aarch64":{"url":"a","signature":"other"},"darwin-x86_64":{"url":"x","signature":"sx"},"linux-x86_64":{"url":"l","signature":"sl"}}}"#;

#[test]
fn a_rerun_intel_build_joins_the_feed_its_version_already_published() {
    let fixture =
        PublishFixture::new(RELEASE_VERSION).with_feeds(FEED_WITH_INTEL, FEED_WITHOUT_INTEL);
    assert_publish_success(&fixture.run());
    let calls = fixture.gh_calls();
    assert!(called(&calls, "release upload desktop-stable "), "{calls}");
    assert!(
        called(&calls, &format!("release edit {RELEASE_TAG} ")),
        "{calls}"
    );
}

#[test]
fn a_same_version_feed_may_only_add_platforms() {
    for (candidate, current) in [
        (FEED_WITH_CHANGED_ARM, FEED_WITHOUT_INTEL),
        (FEED_WITHOUT_INTEL, FEED_WITH_INTEL),
    ] {
        let fixture = PublishFixture::new(RELEASE_VERSION).with_feeds(candidate, current);
        let output = fixture.run();
        assert!(!output.status.success(), "{output:?}");
        assert!(
            String::from_utf8_lossy(&output.stderr).contains("with different content"),
            "{output:?}"
        );
        assert!(
            !called(&fixture.gh_calls(), "release upload desktop-stable "),
            "{}",
            fixture.gh_calls()
        );
    }
}

const MAC_LINK: &str = "Macro-macos-arm64.dmg";
const LINUX_LINK: &str = "Macro-linux-x86_64.AppImage";
const INTEL_LINK: &str = "Macro-macos-x86_64.dmg";

/// A release with assets kept as JSON, edited by a stub `gh`, so the link
/// script runs against the asset operations it would make on GitHub.
struct LinksFixture {
    temp: tempfile::TempDir,
}

impl LinksFixture {
    fn new(channel_version: &str) -> Self {
        let temp = tempfile::tempdir().expect("links fixture directory");
        let root = temp.path();
        let bin = root.join("bin");
        fs::create_dir(&bin).expect("mock command directory");
        let artifacts = root.join("release-artifacts");
        fs::create_dir(&artifacts).expect("release artifacts directory");
        fs::write(
            artifacts.join("latest.json"),
            format!("{{\"version\":\"{RELEASE_VERSION}\"}}\n"),
        )
        .expect("candidate feed");
        fs::write(
            artifacts.join(format!("Macro-{RELEASE_VERSION}-aarch64-darwin.dmg")),
            "new dmg",
        )
        .expect("dmg");
        fs::write(
            artifacts.join(format!("Macro-{RELEASE_VERSION}-x86_64-linux.AppImage")),
            "new appimage",
        )
        .expect("appimage");
        fs::write(
            root.join("channel-latest.json"),
            format!("{{\"version\":\"{channel_version}\"}}\n"),
        )
        .expect("channel feed");
        fs::write(root.join("assets.json"), "[]").expect("asset state");
        write_command(
            &bin,
            "gh",
            r#"#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$STUB_GH_LOG"
state="$STUB_ROOT/assets.json"
case "$1 $2" in
  'release download')
    [[ "$3" == desktop-stable ]]
    while [[ "$1" != --dir ]]; do shift; done
    cp "$STUB_ROOT/channel-latest.json" "$2/latest.json"
    ;;
  'release upload')
    [[ "$3" == desktop-stable && " $* " == *' --clobber '* ]]
    name=$(basename "$4")
    digest="sha256:$(sha256sum "$4" | cut -d' ' -f1)"
    id=$(( $(jq 'map(.id) | max // 0' "$state") + 1 ))
    jq --arg name "$name" --arg digest "$digest" --argjson id "$id" --argjson size "$(stat -c %s "$4")" \
      'map(select(.name != $name)) + [{id: $id, name: $name, size: $size, digest: $digest}]' \
      "$state" > "$state.tmp"
    mv "$state.tmp" "$state"
    ;;
  'release edit') [[ "$3" == desktop-stable ]] ;;
  'api repos/macro-inc/macro/releases/tags/desktop-stable') printf '{"id":7}\n' ;;
  'api repos/macro-inc/macro/releases/7/assets?per_page=100') cat "$state" ;;
  'api --method')
    id=${4##*/}
    case "$3" in
      DELETE) jq --argjson id "$id" 'map(select(.id != $id))' "$state" > "$state.tmp" ;;
      PATCH)
        [[ "$5" == -f && "$6" == name=* ]]
        jq --argjson id "$id" --arg name "${6#name=}" \
          'map(if .id == $id then .name = $name else . end)' "$state" > "$state.tmp"
        ;;
      *) exit 2 ;;
    esac
    mv "$state.tmp" "$state"
    ;;
  *) exit 2 ;;
esac
"#,
        );
        Self { temp }
    }

    /// Seeds desktop-stable with an asset holding `contents`.
    fn with_asset(self, id: u32, name: &str, contents: &str) -> Self {
        let state = self.temp.path().join("assets.json");
        let mut assets: Vec<serde_json::Value> =
            serde_json::from_str(&fs::read_to_string(&state).expect("asset state"))
                .expect("asset JSON");
        assets.push(serde_json::json!({
            "id": id,
            "name": name,
            "size": contents.len(),
            "digest": format!("sha256:{}", sha256_hex(contents)),
        }));
        fs::write(&state, serde_json::to_string(&assets).expect("asset JSON"))
            .expect("asset state");
        self
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
            .env("STUB_ROOT", root)
            .env(
                "STUB_SCRIPT",
                Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join("src/workflows/scripts/publish_desktop_download_links.sh"),
            )
            .env("STUB_GH_LOG", root.join("gh.log"))
            .env("RELEASE_REPOSITORY", "macro-inc/macro")
            .output()
            .expect("run desktop download link script")
    }

    fn gh_calls(&self) -> String {
        fs::read_to_string(self.temp.path().join("gh.log")).expect("GitHub command log")
    }

    /// Asset name to SHA-256 hex digest, as desktop-stable now holds them.
    fn assets(&self) -> std::collections::BTreeMap<String, String> {
        let state = fs::read_to_string(self.temp.path().join("assets.json")).expect("asset state");
        let assets: Vec<serde_json::Value> = serde_json::from_str(&state).expect("asset JSON");
        assets
            .into_iter()
            .map(|asset| {
                (
                    asset["name"].as_str().expect("asset name").to_owned(),
                    asset["digest"]
                        .as_str()
                        .expect("asset digest")
                        .trim_start_matches("sha256:")
                        .to_owned(),
                )
            })
            .collect()
    }
}

fn sha256_hex(contents: &str) -> String {
    let output = Command::new("sha256sum")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .spawn()
        .and_then(|mut child| {
            use std::io::Write;
            child
                .stdin
                .take()
                .expect("sha256sum stdin")
                .write_all(contents.as_bytes())?;
            child.wait_with_output()
        })
        .expect("sha256sum");
    String::from_utf8(output.stdout)
        .expect("sha256sum output")
        .split_whitespace()
        .next()
        .expect("digest")
        .to_owned()
}

#[test]
fn download_links_publish_fixed_name_installers_for_the_promoted_release() {
    let fixture = LinksFixture::new(RELEASE_VERSION).with_asset(1, "latest.json", "feed");
    assert_publish_success(&fixture.run());
    let assets = fixture.assets();
    assert_eq!(
        assets.get(MAC_LINK),
        Some(&sha256_hex("new dmg")),
        "{assets:?}"
    );
    assert_eq!(
        assets.get(LINUX_LINK),
        Some(&sha256_hex("new appimage")),
        "{assets:?}"
    );
    assert!(assets.contains_key("latest.json"), "{assets:?}");
    assert_eq!(assets.len(), 3, "no staging copies remain: {assets:?}");
    assert!(called(&fixture.gh_calls(), "release edit desktop-stable "));
}

#[test]
fn download_links_replace_old_installers_only_after_the_new_upload() {
    let fixture = LinksFixture::new(RELEASE_VERSION)
        .with_asset(1, MAC_LINK, "old dmg")
        .with_asset(2, LINUX_LINK, "old appimage");
    assert_publish_success(&fixture.run());
    let assets = fixture.assets();
    assert_eq!(
        assets.get(MAC_LINK),
        Some(&sha256_hex("new dmg")),
        "{assets:?}"
    );
    assert_eq!(assets.len(), 2, "{assets:?}");

    // The public name keeps serving the old file until its replacement is uploaded.
    let calls = fixture.gh_calls();
    let lines: Vec<&str> = calls.lines().collect();
    let position = |prefix: &str| {
        lines
            .iter()
            .position(|line| line.starts_with(prefix))
            .unwrap_or_else(|| panic!("missing {prefix}: {calls}"))
    };
    let upload = position("release upload desktop-stable ");
    let delete = position("api --method DELETE repos/macro-inc/macro/releases/assets/1");
    assert!(upload < delete, "{calls}");
    assert!(
        lines[upload].contains(&format!("next-{MAC_LINK}")),
        "uploads go to a staging name: {calls}"
    );
}

#[test]
fn download_links_skip_installers_already_published() {
    let fixture = LinksFixture::new(RELEASE_VERSION)
        .with_asset(1, MAC_LINK, "new dmg")
        .with_asset(2, LINUX_LINK, "new appimage");
    assert_publish_success(&fixture.run());
    let calls = fixture.gh_calls();
    assert!(!called(&calls, "release upload "), "{calls}");
    assert!(!called(&calls, "api --method "), "{calls}");
}

#[test]
fn download_links_follow_only_the_promoted_release() {
    let fixture = LinksFixture::new("2026.1017.0").with_asset(1, MAC_LINK, "newer dmg");
    assert_publish_success(&fixture.run());
    let calls = fixture.gh_calls();
    assert_eq!(calls.lines().count(), 1, "only the feed is read: {calls}");
    assert_eq!(
        fixture.assets().get(MAC_LINK),
        Some(&sha256_hex("newer dmg"))
    );
}

#[test]
fn download_links_recover_from_a_swap_that_failed_after_the_delete() {
    // A previous run uploaded the staging copy and deleted the old link, then
    // failed to rename: the rerun must restore the link and leave no staging copy.
    let fixture = LinksFixture::new(RELEASE_VERSION)
        .with_asset(1, &format!("next-{MAC_LINK}"), "new dmg")
        .with_asset(2, LINUX_LINK, "new appimage");
    assert_publish_success(&fixture.run());
    let assets = fixture.assets();
    assert_eq!(
        assets.get(MAC_LINK),
        Some(&sha256_hex("new dmg")),
        "{assets:?}"
    );
    assert_eq!(assets.len(), 2, "{assets:?}");
}

#[test]
fn download_links_fail_without_the_installer() {
    let fixture = LinksFixture::new(RELEASE_VERSION);
    fs::remove_file(fixture.temp.path().join(format!(
        "release-artifacts/Macro-{RELEASE_VERSION}-x86_64-linux.AppImage"
    )))
    .expect("remove AppImage");
    let output = fixture.run();
    assert!(
        !output.status.success(),
        "a missing installer must fail the step"
    );
    assert!(
        fixture.assets().is_empty(),
        "no link changes: {:?}",
        fixture.assets()
    );
}

#[test]
fn windows_failure_leaves_the_macos_and_linux_release_alone() {
    let yaml = rendered_yaml();
    let installers = job_yaml(&yaml, "publish-installers");
    // It waits for Windows, so a published installer ships with the release,
    // but only macOS and Linux must have succeeded.
    assert!(installers.contains("- launch-windows"), "{installers}");
    assert!(installers.contains("!cancelled()"), "{installers}");
    assert!(
        installers.contains("needs.build-appimage.result == ''success''")
            && installers.contains("needs.build-dmg.result == ''success''")
            && !installers.contains("needs.build-windows.result")
            && !installers.contains("needs.launch-windows.result"),
        "{installers}"
    );
    let updates = job_yaml(&yaml, "publish-release");
    assert!(
        updates.contains("!cancelled()")
            && updates.contains("needs.publish-installers.result == ''success''")
            && updates.contains("needs.qa-macos.result == ''success''"),
        "{updates}"
    );
}

#[test]
fn publish_jobs_take_only_release_artifacts() {
    let yaml = rendered_yaml();
    for id in ["publish-installers", "publish-release"] {
        let publish = job_yaml(&yaml, id);
        assert!(publish.contains("pattern: macro-*"), "{publish}");
    }
    let windows = job_yaml(&yaml, "build-windows");
    assert!(windows.contains("name: windows-installer-"), "{windows}");
    assert!(!windows.contains("name: macro-windows-"), "{windows}");
    // Only an installer that launched and may be published joins the release.
    let launch = job_yaml(&yaml, "launch-windows");
    assert!(launch.contains("- build-windows"), "{launch}");
    assert!(launch.contains("name: windows-installer-"), "{launch}");
    assert!(
        launch.contains("if: needs.build-windows.outputs.publish == 'true'")
            && launch.contains("name: macro-windows-"),
        "{launch}"
    );
    let frontend = job_yaml(&yaml, "build-windows-frontend");
    assert!(frontend.contains("name: windows-frontend-"), "{frontend}");
}

#[test]
fn windows_release_signs_through_its_environment_identity() {
    let yaml = rendered_yaml();
    let windows = job_yaml(&yaml, "build-windows");
    assert!(windows.contains("id-token: write"), "{windows}");
    assert!(
        windows.contains("name: desktop-windows-signing"),
        "{windows}"
    );
    assert!(
        windows.contains("vars.WINDOWS_SIGNING_AZURE_CLIENT_ID"),
        "{windows}"
    );
    assert!(
        windows.contains("vars.WINDOWS_DESKTOP_RELEASE"),
        "{windows}"
    );
    assert!(
        windows.contains("SIGN: ${{ startsWith(needs.resolve-ref.outputs.ref, 'refs/tags/v') && 'true' || 'false' }}"),
        "{windows}"
    );
    let frontend = job_yaml(&yaml, "build-windows-frontend");
    assert!(
        frontend.contains("REQUIRE_POSTHOG_API_KEY: 'true'"),
        "{frontend}"
    );
}

#[test]
fn download_links_publish_the_intel_installer_when_the_release_built_it() {
    let fixture = LinksFixture::new(RELEASE_VERSION);
    fs::write(
        fixture.temp.path().join(format!(
            "release-artifacts/Macro-{RELEASE_VERSION}-x86_64-darwin.dmg"
        )),
        "new intel dmg",
    )
    .expect("Intel dmg");
    assert_publish_success(&fixture.run());
    let assets = fixture.assets();
    assert_eq!(
        assets.get(INTEL_LINK),
        Some(&sha256_hex("new intel dmg")),
        "{assets:?}"
    );
    assert_eq!(
        assets.get(MAC_LINK),
        Some(&sha256_hex("new dmg")),
        "{assets:?}"
    );
}

#[test]
fn download_links_leave_the_previous_intel_installer_without_an_intel_build() {
    let fixture = LinksFixture::new(RELEASE_VERSION).with_asset(1, INTEL_LINK, "older intel dmg");
    assert_publish_success(&fixture.run());
    let assets = fixture.assets();
    assert_eq!(
        assets.get(INTEL_LINK),
        Some(&sha256_hex("older intel dmg")),
        "{assets:?}"
    );
    assert_eq!(
        assets.get(MAC_LINK),
        Some(&sha256_hex("new dmg")),
        "{assets:?}"
    );
}
