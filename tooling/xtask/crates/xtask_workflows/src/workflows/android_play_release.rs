//! `Android Play Release` — add the `android-update` label to a PR with
//! Android native changes and this workflow builds the signed App Bundle
//! from the PR head and keeps it as the `android-release` workflow artifact.
//! When it succeeds, [`super::android_play_publish`] (which runs `main`'s
//! copy) uploads it to Google Play's internal track and promotes it to
//! production (full rollout; Google review applies) — the release the
//! `Android Native Check` merge gate (a job of [`super::web_app_check_main`])
//! then waits on; [`super::android_release_watch`] re-runs the gate once the
//! release is live. The iOS counterpart is [`super::ios_app_store_release`].
//!
//! This workflow runs the PR's code, so it gets no Play access: only the
//! publisher can sign in to Play.
//!
//! The PR must already contain the version code bump (`just android-bump`
//! in `apps/web`, committed): the preconditions verify it against the base
//! branch and fail fast otherwise. Release retries are label-driven (remove
//! and re-add `android-update`).
//!
//! Play is the only artifact store that matters: the bundle and its R8
//! mapping are also kept as a workflow artifact (90 days), but nothing ties
//! Play releases to production release tags. Each production release gets a
//! sideloadable APK instead, from [`super::android_apk_on_release`].
//!
//! Credentials: the signing keystore and Firebase config come from Doppler
//! (`android-release/prd` via `ANDROID_RELEASE_DOPPLER_TOKEN`).

use gh_workflow::{
    Concurrency, Event, Expression, Job, Level, Permissions, PullRequest, PullRequestType, Run,
    Step, Use, Workflow,
};

use crate::workflows::android_build::{self, Artifact};
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
                // The failure comment names the step that failed.
                .actions(Level::Read)
                .checks(Level::Read)
                .contents(Level::Read)
                .pull_requests(Level::Write)
                .statuses(Level::Read),
        )
        .add_env(("CI", "true"))
        .add_env(("GH_TOKEN", "${{ github.token }}"))
        .add_env(("GH_REPO", "${{ github.repository }}"))
        .add_env(("PR_NUMBER", "${{ github.event.pull_request.number }}"))
        .add_env(("BASE_BRANCH", "${{ github.event.pull_request.base.ref }}"))
        .add_step(checkout_pr_head())
        .add_step(setup_bun())
        .add_step(preconditions())
        .add_step(android_build::install_android_sdk())
        .add_step(setup_nix())
        .add_step(setup_prereqs())
        .add_step(prepare_version_and_signing())
        .add_step(android_build::build(Artifact::Aab))
        .add_step(android_build::preserve_build_log())
        .add_step(verify_and_collect())
        .add_step(head_guard())
        .add_step(upload_workflow_artifact())
        .add_step(android_build::remove_signing_material())
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
    steps::setup_bun_pinned()
}

/// `android-update` means "release this and merge it when it is live", so the
/// PR must already be mergeable: not a draft, every other check on the head
/// commit green (pending ones are waited on), and the version code bumped.
fn preconditions() -> Step<Run> {
    steps::logged_run(
        "Require the PR to be ready to merge",
        concat!(
            include_str!("scripts/android_git_fetch.sh"),
            include_str!("scripts/pr_merge_commit.sh"),
            include_str!("scripts/merge_result_native_check.sh"),
            include_str!("scripts/android_release_preconditions.sh"),
            include_str!("scripts/release_wait_for_checks.sh")
        ),
    )
    .id("preconditions")
    .working_directory(xtask_paths::repo_dir!("apps/web"))
    .add_env(("HEAD_SHA", "${{ github.event.pull_request.head.sha }}"))
    .add_env(("WAIT_MINUTES", "30"))
    .add_env(("RELEASE_LABEL", "android-update"))
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

fn verify_and_collect() -> Step<Run> {
    steps::logged_run(
        "Verify and collect App Bundle",
        indoc::indoc! {r#"
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
        "#},
    )
    .id("artifact")
    .working_directory(xtask_paths::repo_dir!("apps/web"))
    .add_env(("VERSION_CODE", "${{ steps.preconditions.outputs.version_code }}"))
    .add_env(("RELEASE_FILENAME", "${{ steps.metadata.outputs.filename }}"))
}

/// Native code pushed while the build ran, on the PR or on `main`, would make
/// the bundle stale; don't upload it (the drift workflow also cancels runs
/// after the fact).
fn head_guard() -> Step<Run> {
    steps::logged_run(
        "Require the PR's Android native code to be unchanged since the build",
        concat!(
            include_str!("scripts/android_git_fetch.sh"),
            include_str!("scripts/pr_merge_commit.sh"),
            include_str!("scripts/merge_result_native_check.sh"),
            include_str!("scripts/android_release_head_guard.sh")
        ),
    )
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

fn pr_comment() -> Step<Use> {
    Step::new("Comment on the PR")
        .uses(
            "actions",
            "github-script",
            "f28e40c7f34bde8b3046d885e986cb6290c5673b",
        )
        // Failures only: Android Play Publish comments the outcome of a
        // successful build. Not `always()` either: a run the drift workflow
        // cancelled must not post "failed, re-add the label" next to drift's
        // own comment.
        .if_condition(Expression::new("failure()"))
        .add_with(("github-token", "${{ secrets.GITHUB_TOKEN }}"))
        .add_with((
            "script",
            indoc::indoc! {r#"
                const fs = require('fs');
                const path = require('path');
                const versionCode = '${{ steps.preconditions.outputs.version_code }}' || '?';
                const releaseName = '${{ steps.metadata.outputs.release_name }}' || `version code ${versionCode}`;
                const runUrl =
                  `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}` +
                  `/actions/runs/${context.runId}`;
                // Name the failed step and, when it is one that logs its
                // output (steps::logged_run), quote the end of that output.
                let failedStep = null;
                try {
                  const { data } = await github.rest.actions.listJobsForWorkflowRunAttempt({
                    owner: context.repo.owner,
                    repo: context.repo.repo,
                    run_id: context.runId,
                    attempt_number: Number(process.env.GITHUB_RUN_ATTEMPT),
                  });
                  const job = data.jobs.find((j) => j.name === 'Android Play Release');
                  failedStep = job?.steps.find((s) => s.conclusion === 'failure')?.name ?? null;
                } catch (error) {
                  core.warning(`Could not list this job's steps: ${error.message}`);
                }
                const read = (file) => {
                  try {
                    return fs.readFileSync(path.join(process.env.RUNNER_TEMP, file), 'utf8');
                  } catch {
                    return '';
                  }
                };
                let tail = '';
                if (failedStep && read('last-step.name').trim() === failedStep) {
                  const lines = read('last-step.log').replace(/\x1b\[[0-9;]*m/g, '').trimEnd().split('\n');
                  tail = lines.slice(-30).join('\n').slice(-3000);
                }
                const body = [
                  `🤖 Android Play release for ${releaseName} **failed**${failedStep ? ` at **${failedStep}**` : ''} — see the [workflow run](${runUrl}).`,
                  ...(tail ? ['', '```text', tail, '```'] : []),
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

#[cfg(test)]
mod test;
