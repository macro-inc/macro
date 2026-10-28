//! `Android Play Release` — add the `android-update` label to a PR with
//! Android native changes and this workflow builds the signed App Bundle
//! from the PR head, uploads it to Google Play's internal track and promotes
//! it to production (full rollout; Google review applies) — the release the
//! `Android Native Check` merge gate (a job of [`super::web_app_check_main`])
//! then waits on; [`super::android_release_watch`] re-runs the gate once the
//! release is live. The iOS counterpart is [`super::ios_app_store_release`].
//!
//! The PR must already contain the version code bump (`just android-bump`
//! in `apps/web`, committed): the preconditions verify it against the base
//! branch and fail fast otherwise. Release retries are label-driven (remove
//! and re-add `android-update`).
//!
//! Play is the only artifact store that matters: the bundle and its R8
//! mapping are also kept as a workflow artifact, but nothing ties releases to
//! production release tags any more (the former tag-driven
//! `release-android.yml` is gone). Each upload carries a provenance stamp in
//! its release notes — the Android native hash it was built from and the PR
//! number — that the gate and the watcher compare against the PR's merge
//! result, exactly like the iOS TestFlight stamp.
//!
//! Credentials: the signing keystore and Firebase config come from Doppler
//! (`android-release/prd` via `ANDROID_RELEASE_DOPPLER_TOKEN`); Play access is
//! keyless (Workload Identity Federation through the repository variables
//! `GOOGLE_PLAY_WORKLOAD_IDENTITY_PROVIDER` / `GOOGLE_PLAY_SERVICE_ACCOUNT`).

use gh_workflow::{
    Concurrency, Event, Expression, Job, Level, Permissions, PullRequest, PullRequestType, Run,
    Step, Use, Workflow,
};

use crate::workflows::{steps, vars};

/// Build the workflow.
pub fn android_play_release() -> Workflow {
    Workflow::new("Android Play Release")
        .on(Event::default()
            .pull_request(PullRequest::default().add_type(PullRequestType::Labeled)))
        .concurrency(Concurrency::new(Expression::new(
            "android-play-release-${{ github.event.pull_request.number }}",
        )))
        .add_job("release", release_job())
}

fn release_job() -> Job {
    Job::default()
        .name("Android Play Release")
        // Same-repo PRs only: the release needs the signing secrets and the
        // Play identity, which fork PRs don't receive anyway.
        .cond(Expression::new(
            "github.event.label.name == 'android-update' && \
             github.event.pull_request.head.repo.full_name == github.repository",
        ))
        // The former tag-driven build ran on this hosted image (Android SDK
        // preinstalled, no Nix cache mount; see docs/development/android.md).
        .runs_on("ubuntu-24.04")
        .timeout_minutes(90u32)
        .permissions(
            Permissions::default()
                .checks(Level::Read)
                .contents(Level::Read)
                .id_token(Level::Write)
                .pull_requests(Level::Write)
                .statuses(Level::Read),
        )
        .add_env(("CI", "true"))
        .add_env(("GH_TOKEN", "${{ github.token }}"))
        .add_env(("GH_REPO", "${{ github.repository }}"))
        .add_env(("PR_NUMBER", "${{ github.event.pull_request.number }}"))
        .add_step(checkout_pr_head())
        .add_step(setup_bun())
        .add_step(preconditions())
        .add_step(install_android_sdk())
        .add_step(setup_nix())
        .add_step(setup_prereqs())
        .add_step(prepare_version_and_signing())
        .add_step(build_bundle())
        .add_step(preserve_build_log())
        .add_step(verify_and_collect())
        .add_step(head_guard())
        .add_step(provenance_stamp())
        .add_step(upload_workflow_artifact())
        .add_step(play_auth())
        .add_step(upload_internal())
        .add_step(promote_production())
        .add_step(remove_signing_material())
        .add_step(pr_comment())
}

fn checkout_pr_head() -> Step<Use> {
    Step::new("Checkout PR head")
        .uses(
            "actions",
            "checkout",
            "df4cb1c069e1874edd31b4311f1884172cec0e10",
        ) // v6
        .add_with(("ref", "${{ github.event.pull_request.head.sha }}"))
        .add_with(("persist-credentials", false))
}

/// Bun before Nix: the preconditions run the Android scripts before the
/// toolchain is set up.
fn setup_bun() -> Step<Use> {
    Step::new("Setup Bun")
        .uses(
            "oven-sh",
            "setup-bun",
            "0c5077e51419868618aeaa5fe8019c62421857d6",
        ) // v2.2.0
        .add_with(("bun-version", "1.3.13"))
}

/// `android-update` means "release this and merge it when it is live", so the
/// PR must already be mergeable: not a draft, every other check on the head
/// commit green (pending ones are waited on), and the version code bumped.
fn preconditions() -> Step<Run> {
    Step::new("Require the PR to be ready to merge")
        .run(concat!(
            include_str!("scripts/android_git_fetch.sh"),
            include_str!("scripts/pr_merge_commit.sh"),
            include_str!("scripts/android_release_preconditions.sh")
        ))
        .id("preconditions")
        .shell("bash")
        .working_directory(xtask_paths::repo_dir!("apps/web"))
        .add_env(("HEAD_SHA", "${{ github.event.pull_request.head.sha }}"))
        .add_env(("WAIT_MINUTES", "30"))
}

fn install_android_sdk() -> Step<Run> {
    Step::new("Install Android SDK components")
        .run(indoc::indoc! {r#"
            set -euo pipefail
            export JAVA_HOME="$JAVA_HOME_21_X64"
            export PATH="$JAVA_HOME/bin:$PATH"
            "$ANDROID_HOME/cmdline-tools/latest/bin/sdkmanager" \
              'platforms;android-36' 'build-tools;36.0.0' 'ndk;30.0.16248370'
            echo "JAVA_HOME=$JAVA_HOME" >> "$GITHUB_ENV"
            echo "NDK_HOME=$ANDROID_HOME/ndk/30.0.16248370" >> "$GITHUB_ENV"
        "#})
        .shell("bash")
}

fn setup_nix() -> Step<Use> {
    steps::setup_nix()
}

fn setup_prereqs() -> Step<Use> {
    steps::setup_reqs_web("Setup prerequisites", false)
}

/// Pull-request releases are named by version code (`vc<code>`), not by a
/// production release tag.
fn prepare_version_and_signing() -> Step<Run> {
    Step::new("Prepare version and signing")
        .run(indoc::indoc! {r#"
            set -euo pipefail
            filename=$(bun scripts/android-release.ts metadata "vc${VERSION_CODE}" "$RUNNER_TEMP/android-release.json")
            echo "filename=$filename" >> "$GITHUB_OUTPUT"
            echo "release_name=$(jq -r .version tauri/src-tauri/tauri.android.conf.json) (${VERSION_CODE})" >> "$GITHUB_OUTPUT"
            bun scripts/android-release.ts signing "$RUNNER_TEMP/android-signing" \
              tauri/src-tauri/gen/android/keystore.properties
            bun scripts/android-firebase.ts build --doppler "$RUNNER_TEMP/android-google-services.json"
        "#})
        .id("metadata")
        .shell("bash")
        .working_directory(xtask_paths::repo_dir!("apps/web"))
        .add_env(("VERSION_CODE", "${{ steps.preconditions.outputs.version_code }}"))
        .add_env(("DOPPLER_TOKEN", vars::ANDROID_RELEASE_DOPPLER_TOKEN))
}

fn build_bundle() -> Step<Run> {
    Step::new("Build production App Bundle")
        .run(indoc::indoc! {r#"
            set -euo pipefail
            # The Nix environment is already loaded. Do not reload it in nested
            # bash processes and re-enable its local-development sccache wrapper.
            # This ephemeral runner has no compiler cache/server to reuse.
            unset BASH_ENV
            export RUSTC_WRAPPER=""
            cargo tauri --version
            # Tauri has shipped both switch-only and value-taking APK/AAB flags.
            # Nix and local installations can differ; build only the AAB with either CLI.
            android_help=$(cargo tauri android build --help)
            artifact_args=(--aab)
            if [[ "$android_help" == *'--apk <APK>'* ]]; then
              artifact_args=(--apk false --aab true)
            fi
            just android-build --firebase-config "$RUNNER_TEMP/android-google-services.json" \
              "${artifact_args[@]}" --ci --config "$RUNNER_TEMP/android-release.json" \
              2>&1 | tee "$RUNNER_TEMP/android-build.log"
        "#})
        .shell("bash")
        .working_directory(xtask_paths::repo_dir!("apps/web"))
        .add_env((
            "VITE_SEGMENT_WRITE_KEY",
            "${{ secrets.SEGMENT_WRITE_KEY_PRODUCTION }}",
        ))
        .add_env(("VITE_POSTHOG_API_KEY", vars::POSTHOG_API_KEY))
        .add_env((
            "VITE_OTEL_EXPORTER_URL",
            "https://macro-prox-prod.macroverse.workers.dev/i/otlp/v1/traces",
        ))
        .add_env(("VITE_OTEL_ENV", "prod"))
}

fn preserve_build_log() -> Step<Use> {
    Step::new("Preserve Android build log")
        .uses(
            "actions",
            "upload-artifact",
            "ea165f8d65b6e75b540449e92b4886f43607fa02",
        ) // v4
        .if_condition(Expression::new("always()"))
        .add_with(("name", "android-build-log"))
        .add_with(("path", "${{ runner.temp }}/android-build.log"))
        .add_with(("if-no-files-found", "ignore"))
        .add_with(("retention-days", 7))
}

fn verify_and_collect() -> Step<Run> {
    Step::new("Verify and collect App Bundle")
        .run(indoc::indoc! {r#"
            set -euo pipefail
            curl --fail --location --retry 3 \
              https://github.com/google/bundletool/releases/download/1.18.3/bundletool-all-1.18.3.jar \
              --output "$RUNNER_TEMP/bundletool.jar"
            echo "a099cfa1543f55593bc2ed16a70a7c67fe54b1747bb7301f37fdfd6d91028e29  $RUNNER_TEMP/bundletool.jar" | sha256sum --check
            mapfile -t bundles < <(find tauri/src-tauri/gen/android/app/build/outputs/bundle -type f -name '*-release.aab')
            if [ "${#bundles[@]}" -ne 1 ]; then
              echo "Expected exactly one signed release AAB, found ${#bundles[@]}" >&2
              exit 1
            fi
            bun scripts/android-bundle.ts "vc${VERSION_CODE}" "${bundles[0]}" \
              "$RUNNER_TEMP/bundletool.jar" "$RUNNER_TEMP/android-signing/certificate-sha256"
            bundle_filename="${RELEASE_FILENAME%.*}.aab"
            mkdir -p "$GITHUB_WORKSPACE/android-artifacts"
            cp "${bundles[0]}" "$GITHUB_WORKSPACE/android-artifacts/$bundle_filename"
            # R8 mapping belongs to this exact binary; preserve it for Play crash reports.
            bundle_variant=$(basename "$(dirname "${bundles[0]}")")
            mapping="tauri/src-tauri/gen/android/app/build/outputs/mapping/$bundle_variant/mapping.txt"
            if [[ ! -s "$mapping" ]]; then
              echo "Missing R8 mapping for bundle variant $bundle_variant" >&2
              exit 1
            fi
            mapping_filename="${bundle_filename%.aab}-mapping.txt"
            cp "$mapping" "$GITHUB_WORKSPACE/android-artifacts/$mapping_filename"
            \cd "$GITHUB_WORKSPACE/android-artifacts"
            sha256sum "$bundle_filename" > "$bundle_filename.sha256"
            sha256sum "$mapping_filename" > "$mapping_filename.sha256"
            echo "bundle=$GITHUB_WORKSPACE/android-artifacts/$bundle_filename" >> "$GITHUB_OUTPUT"
            echo "mapping=$GITHUB_WORKSPACE/android-artifacts/$mapping_filename" >> "$GITHUB_OUTPUT"
        "#})
        .id("artifact")
        .shell("bash")
        .working_directory(xtask_paths::repo_dir!("apps/web"))
        .add_env(("VERSION_CODE", "${{ steps.preconditions.outputs.version_code }}"))
        .add_env(("RELEASE_FILENAME", "${{ steps.metadata.outputs.filename }}"))
}

/// Native code pushed while the build ran would make the bundle stale; don't
/// upload it (the drift workflow also cancels runs after the fact).
fn head_guard() -> Step<Run> {
    Step::new("Require the PR's Android native code to be unchanged since the build")
        .run(concat!(
            include_str!("scripts/android_git_fetch.sh"),
            include_str!("scripts/pr_merge_commit.sh"),
            include_str!("scripts/android_release_head_guard.sh")
        ))
        .shell("bash")
        .working_directory(xtask_paths::repo_dir!("apps/web"))
}

/// The release notes carry the native hash and PR number, which the gate and
/// the watcher compare against the merge result (the TestFlight stamp's twin).
fn provenance_stamp() -> Step<Run> {
    Step::new("Write the provenance stamp as release notes")
        .run(indoc::indoc! {r#"
            set -euo pipefail
            hash=$(bun scripts/android-native.mjs hash HEAD)
            mkdir -p "$RUNNER_TEMP/whatsnew"
            printf 'native tree %s for PR #%s\n' "$hash" "$PR_NUMBER" > "$RUNNER_TEMP/whatsnew/whatsnew-en-US"
            echo "Stamp: native tree ${hash} for PR #${PR_NUMBER}"
        "#})
        .shell("bash")
        .working_directory(xtask_paths::repo_dir!("apps/web"))
}

fn upload_workflow_artifact() -> Step<Use> {
    Step::new("Upload verified Android artifact")
        .uses(
            "actions",
            "upload-artifact",
            "ea165f8d65b6e75b540449e92b4886f43607fa02",
        ) // v4
        .add_with(("name", "android-release"))
        .add_with(("path", "android-artifacts/"))
        .add_with(("if-no-files-found", "error"))
        .add_with(("retention-days", 90))
}

/// Keyless Play access: a credentials file for the upload action and an
/// access token for the promotion script.
fn play_auth() -> Step<Use> {
    Step::new("Authenticate to Google Play")
        .uses(
            "google-github-actions",
            "auth",
            "7c6bc770dae815cd3e89ee6cdf493a5fab2cc093",
        ) // v3
        .id("auth")
        .add_with((
            "workload_identity_provider",
            "${{ vars.GOOGLE_PLAY_WORKLOAD_IDENTITY_PROVIDER }}",
        ))
        .add_with(("service_account", "${{ vars.GOOGLE_PLAY_SERVICE_ACCOUNT }}"))
        .add_with(("token_format", "access_token"))
        .add_with((
            "access_token_scopes",
            "https://www.googleapis.com/auth/androidpublisher",
        ))
        .add_with(("export_environment_variables", false))
}

fn upload_internal() -> Step<Use> {
    Step::new("Upload to internal testing")
        .uses(
            "r0adkll",
            "upload-google-play",
            "e738b9dd8f2476ea806d921b64aacd24f34515a5",
        ) // v1
        .add_with((
            "serviceAccountJson",
            "${{ steps.auth.outputs.credentials_file_path }}",
        ))
        .add_with(("packageName", "com.macro.workspace.mobile"))
        .add_with(("releaseFiles", "${{ steps.artifact.outputs.bundle }}"))
        .add_with(("mappingFile", "${{ steps.artifact.outputs.mapping }}"))
        .add_with(("releaseName", "${{ steps.metadata.outputs.release_name }}"))
        .add_with(("track", "internal"))
        .add_with(("status", "completed"))
        .add_with(("whatsNewDirectory", "${{ runner.temp }}/whatsnew"))
}

/// Internal → production, full rollout. Play can take a moment to show the
/// internal release in a fresh edit, so the promotion is retried briefly.
fn promote_production() -> Step<Run> {
    Step::new("Promote to production")
        .run(indoc::indoc! {r#"
            set -euo pipefail
            for attempt in 1 2 3 4 5; do
              if node scripts/android-play-promote.mjs; then
                exit 0
              fi
              echo "Promotion attempt ${attempt} failed; retrying in 30s."
              sleep 30
            done
            echo "Could not promote version code ${VERSION_CODE} to production; promote it by hand with publish-android-play.yml (operation=promote-production)." >&2
            exit 1
        "#})
        .shell("bash")
        .working_directory(xtask_paths::repo_dir!("apps/web"))
        .add_env(("GOOGLE_PLAY_ACCESS_TOKEN", "${{ steps.auth.outputs.access_token }}"))
        .add_env(("VERSION_CODE", "${{ steps.preconditions.outputs.version_code }}"))
        .add_env(("CHANGES_NOT_SENT_FOR_REVIEW", "false"))
}

fn remove_signing_material() -> Step<Run> {
    Step::new("Remove signing material")
        .run(indoc::indoc! {r#"
            rm -rf "$RUNNER_TEMP/android-signing" "$RUNNER_TEMP/android-release.json" \
              "$RUNNER_TEMP/android-google-services.json" "$RUNNER_TEMP/whatsnew" || true
            rm -f apps/web/tauri/src-tauri/gen/android/keystore.properties || true
        "#})
        .if_condition(Expression::new("always()"))
        .shell("bash")
}

fn pr_comment() -> Step<Use> {
    Step::new("Comment on the PR")
        .uses(
            "actions",
            "github-script",
            "f28e40c7f34bde8b3046d885e986cb6290c5673b",
        )
        // Not `always()`: a run the drift workflow cancelled must not post
        // "failed, re-add the label" next to drift's own comment.
        .if_condition(Expression::new("success() || failure()"))
        .add_with(("github-token", "${{ secrets.GITHUB_TOKEN }}"))
        .add_with((
            "script",
            indoc::indoc! {r#"
                const versionCode = '${{ steps.preconditions.outputs.version_code }}' || '?';
                const releaseName = '${{ steps.metadata.outputs.release_name }}' || `version code ${versionCode}`;
                const runUrl =
                  `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}` +
                  `/actions/runs/${context.runId}`;
                const success = '${{ job.status }}' === 'success';
                const body = success
                  ? [
                      `🤖 Android ${releaseName} was uploaded to Google Play internal testing and submitted for a full production rollout.`,
                      '',
                      'When Google approves it, the version goes live, the **Android Release Watch** workflow',
                      're-runs the **Android Native Check** on this PR within half an hour of that, and the PR',
                      'becomes mergeable. To merge it the moment that happens, click **Enable auto-merge** on this PR now (squash).',
                      'After merge, the next prod deploy applies the Android native build floor committed in `min-native-build.json`.',
                      '',
                      `[Workflow run](${runUrl})`,
                    ].join('\n')
                  : [
                      `🤖 Android Play release for ${releaseName} **failed** — see the [workflow run](${runUrl}).`,
                      '',
                      'Fix the problem, then remove and re-add the `android-update` label to retry.',
                    ].join('\n');
                await github.rest.issues.createComment({
                  owner: context.repo.owner,
                  repo: context.repo.repo,
                  issue_number: context.issue.number,
                  body,
                });
            "#},
        ))
}
