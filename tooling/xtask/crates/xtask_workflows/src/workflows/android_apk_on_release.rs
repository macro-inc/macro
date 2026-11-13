//! `Android APK on Release` — builds a signed ARM64 APK from each production
//! release tag and attaches it to that GitHub release as
//! `macro-<tag>-android-arm64.apk` plus its `.sha256`, for sideloading
//! outside Google Play.
//!
//! It runs on the same `release: released` event as `Deploy Production
//! Release` but is a separate workflow with no dependency on it, so it never
//! blocks or slows a production deploy, and its failure doesn't fail one.
//! Play releases come from pull requests instead
//! ([`super::android_play_release`]).
//!
//! The build is the Play App Bundle build with `--apk` (the shared steps and
//! production `VITE_*` environment live in [`super::android_build`]) and is
//! signed with the same Play upload key, so an APK updates an earlier APK
//! install in place but not a Play install, which Play re-signs.
//!
//! To rebuild a release's APK, re-run the failed job, or dispatch this
//! workflow with "Use workflow from" set to that release's tag.
//!
//! Credentials: the signing keystore and Firebase config come from Doppler
//! (`android-release/prd` via `ANDROID_RELEASE_DOPPLER_TOKEN`).

use gh_workflow::{
    Concurrency, Event, Expression, Job, Level, Permissions, Release, ReleaseType, Run, Step, Use,
    Workflow, WorkflowDispatch,
};

use crate::workflows::android_build::{self, Artifact};
use crate::workflows::{runners, steps, vars};

/// Workflow artifact handing the verified APK from the build job to the
/// publish job.
const APK_ARTIFACT: &str = "android-apk";

/// Build the workflow.
pub fn android_apk_on_release() -> Workflow {
    Workflow::new("Android APK on Release")
        .on(Event::default()
            .release(Release::default().add_type(ReleaseType::Released))
            .workflow_dispatch(WorkflowDispatch::default()))
        .concurrency(Concurrency::new(Expression::new(
            "android-apk-on-release-${{ github.ref_name }}",
        )))
        .add_job("build", build_job())
        .add_job("publish", publish_job())
}

fn build_job() -> Job {
    Job::default()
        .name("Build signed Android APK")
        // The Play build's hosted image: Android SDK preinstalled, no Nix
        // cache mount (see docs/development/android.md).
        .runs_on("ubuntu-24.04")
        .timeout_minutes(90u32)
        .permissions(Permissions::default().contents(Level::Read))
        .add_env(("CI", "true"))
        .add_env(("RELEASE_TAG", "${{ github.ref_name }}"))
        .add_step(require_release())
        .add_step(steps::checkout_ref("${{ github.ref }}"))
        .add_step(android_build::install_android_sdk())
        .add_step(steps::setup_nix())
        .add_step(steps::setup_reqs_web("Setup prerequisites", false))
        .add_step(prepare_version_and_signing())
        .add_step(android_build::build(Artifact::Apk))
        .add_step(android_build::preserve_build_log())
        .add_step(verify_and_collect())
        .add_step(upload_workflow_artifact())
        .add_step(android_build::remove_signing_material())
}

fn publish_job() -> Job {
    Job::default()
        .name("Attach the APK to the release")
        .add_needs("build")
        .runs_on(runners::Runner::TinyNoCache.to_string())
        .timeout_minutes(10u32)
        .permissions(Permissions::default().contents(Level::Write))
        .add_env(("RELEASE_TAG", "${{ github.ref_name }}"))
        .add_step(download_workflow_artifact())
        .add_step(upload_release_assets())
}

/// A dispatch can run from any ref; only a published, non-prerelease
/// `vYYYY.M.D[.N]` release gets an APK. `android-release.ts metadata` also
/// accepts the `vc<versionCode>` names of pull-request Play builds, so the tag
/// shape is checked here.
fn require_release() -> Step<Run> {
    Step::new("Require a published production release")
        .run(indoc::indoc! {r#"
            set -euo pipefail
            if [[ "$GITHUB_REF_TYPE" != "tag" || ! "$RELEASE_TAG" =~ ^v20[0-9]{2}\.[0-9]{1,2}\.[0-9]{1,2}(\.[0-9]{1,2})?$ ]]; then
              echo "Run this from a production release tag vYYYY.M.D[.N] (\"Use workflow from\": the tag), not ${GITHUB_REF_NAME}." >&2
              exit 1
            fi
            gh release view "$RELEASE_TAG" --repo "$GITHUB_REPOSITORY" --json isDraft,isPrerelease \
              | jq -e '.isDraft == false and .isPrerelease == false' >/dev/null || {
                echo "${RELEASE_TAG} has no published production release." >&2
                exit 1
              }
        "#})
        .shell("bash")
        .add_env(("GH_TOKEN", "${{ github.token }}"))
}

fn prepare_version_and_signing() -> Step<Run> {
    Step::new("Prepare version and signing")
        .run(indoc::indoc! {r#"
            set -euo pipefail
            filename=$(bun scripts/android-release.ts metadata "$RELEASE_TAG" "$RUNNER_TEMP/android-release.json")
            echo "filename=${filename%.*}.apk" >> "$GITHUB_OUTPUT"
            bun scripts/android-release.ts signing "$RUNNER_TEMP/android-signing" \
              tauri/src-tauri/gen/android/keystore.properties
            bun scripts/android-firebase.ts build --doppler "$RUNNER_TEMP/android-google-services.json"
        "#})
        .id("metadata")
        .shell("bash")
        .working_directory(xtask_paths::repo_dir!("apps/web"))
        .add_env(("DOPPLER_TOKEN", vars::ANDROID_RELEASE_DOPPLER_TOKEN))
}

/// `android-release.ts verify` checks the signing certificate, 16 KB
/// alignment, package, version, ARM64-only native code, and release mode.
fn verify_and_collect() -> Step<Run> {
    Step::new("Verify and collect APK")
        .run(indoc::indoc! {r#"
            set -euo pipefail
            mapfile -t apks < <(find tauri/src-tauri/gen/android/app/build/outputs/apk -type f -name '*-release.apk')
            if [ "${#apks[@]}" -ne 1 ]; then
              echo "Expected exactly one signed ARM64 release APK, found ${#apks[@]}" >&2
              exit 1
            fi
            bun scripts/android-release.ts verify "$RELEASE_TAG" "${apks[0]}" \
              "$ANDROID_HOME/build-tools/36.0.0" "$RUNNER_TEMP/android-signing/certificate-sha256"
            mkdir -p "$GITHUB_WORKSPACE/android-artifacts"
            cp "${apks[0]}" "$GITHUB_WORKSPACE/android-artifacts/$APK_FILENAME"
            \cd "$GITHUB_WORKSPACE/android-artifacts"
            sha256sum "$APK_FILENAME" > "$APK_FILENAME.sha256"
        "#})
        .shell("bash")
        .working_directory(xtask_paths::repo_dir!("apps/web"))
        .add_env(("APK_FILENAME", "${{ steps.metadata.outputs.filename }}"))
}

fn upload_workflow_artifact() -> Step<Use> {
    Step::new("Upload verified APK")
        .uses(
            "actions",
            "upload-artifact",
            "ea165f8d65b6e75b540449e92b4886f43607fa02",
        ) // v4
        .add_with(("name", APK_ARTIFACT))
        .add_with(("path", "android-artifacts/"))
        .add_with(("if-no-files-found", "error"))
        .add_with(("retention-days", 7))
}

fn download_workflow_artifact() -> Step<Use> {
    Step::new("Download verified APK")
        .uses(
            "actions",
            "download-artifact",
            "634f93cb2916e3fdff6788551b99b062d0335ce0",
        ) // v5
        .add_with(("name", APK_ARTIFACT))
        .add_with(("path", "android-artifacts"))
}

/// `--clobber` lets a re-run replace this release's own APK; nothing else on
/// the release is touched.
fn upload_release_assets() -> Step<Run> {
    Step::new("Attach APK and checksum to the release")
        .run(indoc::indoc! {r#"
            set -euo pipefail
            mapfile -t files < <(find android-artifacts -maxdepth 1 -type f -name 'macro-*-android-arm64.apk*')
            if [ "${#files[@]}" -ne 2 ]; then
              echo "Expected the APK and its .sha256, found ${#files[@]} files" >&2
              exit 1
            fi
            (\cd android-artifacts && sha256sum --check ./*.apk.sha256)
            gh release upload "$RELEASE_TAG" "${files[@]}" --repo "$GITHUB_REPOSITORY" --clobber
        "#})
        .shell("bash")
        .add_env(("GH_TOKEN", "${{ github.token }}"))
}
