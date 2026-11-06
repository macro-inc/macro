//! `Android Play Publish` — uploads the App Bundle an
//! [`super::android_play_release`] run built to Google Play's internal track
//! and promotes it to production (full rollout; Google review applies), the
//! release the `Android Native Check` merge gate then waits on.
//!
//! The build and the publish are separate workflows because of the Play
//! credential. `Android Play Release` runs on `pull_request` events, so it
//! executes the PR's copy of the workflow and of every build script and
//! dependency; giving it the publishing identity would hand that identity to
//! whatever a PR proposes. This workflow runs on `workflow_run`, which GitHub
//! always runs from `main`'s copy, so Google's Workload Identity provider
//! admits it with a fixed condition (main's ref and this file; see
//! "Keyless publishing credentials" in docs/development/android.md) instead
//! of a grant per PR.
//!
//! It treats the build run and its artifact as untrusted. The `check` job
//! publishes only a run that the `android-update` label started
//! (`scripts/android_play_publish_verify.sh`): the label, added by a person
//! with write access, is the release decision. The `publish` job then
//! derives everything it tells Play from main's scripts and the PR's commit
//! (version code, provenance stamp, head guard), passes the artifact's files
//! to Play without running anything from them, and records the promotion as
//! the `android-play/release` commit status that
//! [`super::android_release_drift`] reads.
//!
//! Every completed `Android Play Release` run triggers this — the build
//! workflow runs for every label added to a PR, its job skipping the others
//! — so `check` ends quietly when there is nothing to publish, and only
//! `publish` joins the per-branch concurrency group (a queued no-op run would
//! otherwise cancel a pending publish).

use gh_workflow::{
    Concurrency, Event, Expression, Job, Level, Permissions, Run, Step, Use, Workflow, WorkflowRun,
    WorkflowRunType,
};

use crate::workflows::{runners, steps};

#[cfg(test)]
mod test;

/// The `publish` job's name, which its failure comment looks up.
const PUBLISH_JOB_NAME: &str = "Android Play Publish";

/// Build the workflow.
pub fn android_play_publish() -> Workflow {
    Workflow::new("Android Play Publish")
        .on(Event::default().workflow_run(
            WorkflowRun::default()
                .add_type(WorkflowRunType::Completed)
                .add_workflow("Android Play Release"),
        ))
        .add_job("check", check_job())
        .add_job("publish", publish_job())
}

fn check_job() -> Job {
    Job::default()
        .name("Check the release request")
        // The build job skips fork PRs, and fork runs never get here with a
        // successful build; the head-repository test is belt and braces.
        .cond(Expression::new(
            "github.event.workflow_run.conclusion == 'success' && \
             github.event.workflow_run.event == 'pull_request' && \
             github.event.workflow_run.head_repository.full_name == github.repository",
        ))
        .runs_on(runners::Runner::TinyNoCache.to_string())
        .timeout_minutes(10u32)
        .permissions(
            Permissions::default()
                .actions(Level::Read)
                .contents(Level::Read)
                .issues(Level::Read)
                .pull_requests(Level::Write),
        )
        .add_env(("GH_TOKEN", "${{ github.token }}"))
        .add_env(("GH_REPO", "${{ github.repository }}"))
        .add_output("publish", "${{ steps.verify.outputs.publish }}")
        .add_output("pr_number", "${{ steps.verify.outputs.pr_number }}")
        .add_output("version_code", "${{ steps.verify.outputs.version_code }}")
        .add_output("release_name", "${{ steps.verify.outputs.release_name }}")
        .add_step(steps::checkout(false, false))
        .add_step(steps::setup_bun_pinned())
        .add_step(verify())
        .add_step(refusal_comment())
}

fn verify() -> Step<Run> {
    steps::logged_run(
        "Require a build the android-update label started",
        concat!(
            include_str!("scripts/android_git_fetch.sh"),
            include_str!("scripts/android_play_publish_verify.sh")
        ),
    )
    .id("verify")
    .working_directory(xtask_paths::repo_dir!("apps/web"))
    .add_env(("RUN_ID", "${{ github.event.workflow_run.id }}"))
    .add_env((
        "RUN_ATTEMPT",
        "${{ github.event.workflow_run.run_attempt }}",
    ))
    .add_env(("RUN_PATH", "${{ github.event.workflow_run.path }}"))
    .add_env(("RUN_ACTOR", "${{ github.event.workflow_run.actor.login }}"))
    .add_env((
        "RUN_CREATED_AT",
        "${{ github.event.workflow_run.created_at }}",
    ))
    .add_env(("HEAD_SHA", "${{ github.event.workflow_run.head_sha }}"))
    .add_env((
        "HEAD_BRANCH",
        "${{ github.event.workflow_run.head_branch }}",
    ))
}

/// A refusal is worth telling the PR about once the PR is known.
fn refusal_comment() -> Step<Run> {
    Step::new("Comment on the PR")
        .run(indoc::indoc! {r#"
            set -euo pipefail
            reason=$(sed -n 's/\x1b\[[0-9;]*m//g; s/^Not publishing run [0-9]*: //p' "$RUNNER_TEMP/last-step.log" | tail -n 1)
            gh pr comment "$PR_NUMBER" --repo "$GH_REPO" --body "🤖 Android Play Publish did not publish [this Android Play Release build](${BUILD_URL}): ${reason:-see the [workflow run](${RUN_URL}).}

            A person with write access can remove and re-add the \`android-update\` label to release the PR's current head."
        "#})
        .if_condition(Expression::new(
            "failure() && steps.verify.outputs.pr_number != ''",
        ))
        .shell("bash")
        .add_env(("PR_NUMBER", "${{ steps.verify.outputs.pr_number }}"))
        .add_env(("BUILD_URL", "${{ github.event.workflow_run.html_url }}"))
        .add_env((
            "RUN_URL",
            "${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}",
        ))
}

fn publish_job() -> Job {
    Job::default()
        .name(PUBLISH_JOB_NAME)
        .add_needs("check")
        .cond(Expression::new("needs.check.outputs.publish == 'true'"))
        // A hosted image: the upload action and the promotion script need Node.
        .runs_on("ubuntu-24.04")
        .timeout_minutes(30u32)
        // One release at a time per PR branch, queued rather than cancelled:
        // a cancelled run can leave a promotion half-reported.
        .concurrency(Concurrency::new(Expression::new(
            "android-play-publish-${{ github.event.workflow_run.head_branch }}",
        )))
        .permissions(
            Permissions::default()
                // The artifact download and the failure comment's step lookup.
                .actions(Level::Read)
                .contents(Level::Read)
                .id_token(Level::Write)
                .pull_requests(Level::Write)
                .statuses(Level::Write),
        )
        .add_env(("GH_TOKEN", "${{ github.token }}"))
        .add_env(("GH_REPO", "${{ github.repository }}"))
        .add_env(("PR_NUMBER", "${{ needs.check.outputs.pr_number }}"))
        .add_env(("VERSION_CODE", "${{ needs.check.outputs.version_code }}"))
        .add_env(("BUILT_SHA", "${{ github.event.workflow_run.head_sha }}"))
        .add_env(("BASE_BRANCH", "main"))
        .add_step(steps::checkout(false, false))
        .add_step(steps::setup_bun_pinned())
        .add_step(head_guard("upload"))
        .add_step(provenance_stamp())
        .add_step(download_artifact())
        .add_step(pick_files())
        .add_step(steps::google_play_auth(true))
        .add_step(upload_internal())
        .add_step(head_guard("promote"))
        .add_step(mark_promotion_pending())
        .add_step(promote_production())
        .add_step(mark_promotion_result())
        .add_step(pr_comment())
}

/// The PR's native code — and main's — must still be what was built: once
/// before the upload, and again before the irreversible promotion.
fn head_guard(stage: &str) -> Step<Run> {
    let name = if stage == "promote" {
        "Require the native code to be unchanged before promoting"
    } else {
        "Require the PR's Android native code to be unchanged since the build"
    };
    steps::logged_run(
        name,
        concat!(
            include_str!("scripts/android_git_fetch.sh"),
            include_str!("scripts/pr_merge_commit.sh"),
            include_str!("scripts/merge_result_native_check.sh"),
            include_str!("scripts/android_release_head_guard.sh")
        ),
    )
    .working_directory(xtask_paths::repo_dir!("apps/web"))
    .add_env(("GUARD_STAGE", stage))
}

/// The release notes carry the native hash and PR number, which the watcher
/// compares against the merge result (the TestFlight stamp's twin). Computed
/// here, from main's hashing script, not taken from the build.
fn provenance_stamp() -> Step<Run> {
    steps::logged_run(
        "Write the provenance stamp as release notes",
        indoc::indoc! {r#"
            set -euo pipefail
            hash=$(bun scripts/android-native.mjs hash "$BUILT_SHA")
            mkdir -p "$RUNNER_TEMP/whatsnew"
            printf 'native tree %s for PR #%s\n' "$hash" "$PR_NUMBER" > "$RUNNER_TEMP/whatsnew/whatsnew-en-US"
            echo "native_hash=${hash}" >> "$GITHUB_OUTPUT"
            echo "Stamp: native tree ${hash} for PR #${PR_NUMBER}"
        "#},
    )
    .id("stamp")
    .working_directory(xtask_paths::repo_dir!("apps/web"))
}

fn download_artifact() -> Step<Use> {
    Step::new("Download the built App Bundle")
        .uses(
            "actions",
            "download-artifact",
            "634f93cb2916e3fdff6788551b99b062d0335ce0",
        ) // v5
        .add_with(("name", "android-release"))
        .add_with(("run-id", "${{ github.event.workflow_run.id }}"))
        .add_with(("github-token", "${{ github.token }}"))
        .add_with(("path", "${{ runner.temp }}/android-release"))
}

/// The artifact was written by PR code: take exactly one bundle and one
/// mapping with plain file names, as data for Play to check.
fn pick_files() -> Step<Run> {
    steps::logged_run(
        "Pick the bundle and its R8 mapping",
        indoc::indoc! {r#"
            set -euo pipefail
            dir="$RUNNER_TEMP/android-release"
            mapfile -t bundles < <(find "$dir" -maxdepth 1 -type f -name '*.aab' -printf '%f\n')
            mapfile -t mappings < <(find "$dir" -maxdepth 1 -type f -name '*-mapping.txt' -printf '%f\n')
            if (( ${#bundles[@]} != 1 || ${#mappings[@]} != 1 )); then
              echo "Expected one .aab and one -mapping.txt in the android-release artifact, found ${#bundles[@]} and ${#mappings[@]}." >&2
              exit 1
            fi
            for name in "${bundles[0]}" "${mappings[0]}"; do
              if [[ ! "$name" =~ ^[A-Za-z0-9._-]+$ ]]; then
                echo "Refusing the artifact file name ${name}." >&2
                exit 1
              fi
            done
            echo "bundle=${dir}/${bundles[0]}" >> "$GITHUB_OUTPUT"
            echo "mapping=${dir}/${mappings[0]}" >> "$GITHUB_OUTPUT"
            echo "Bundle ${bundles[0]}, mapping ${mappings[0]}."
        "#},
    )
    .id("artifact")
}

fn upload_internal() -> Step<Use> {
    Step::new("Upload to internal testing")
        .uses(
            "r0adkll",
            "upload-google-play",
            "e738b9dd8f2476ea806d921b64aacd24f34515a5",
        ) // v1
        .id("upload")
        .add_with((
            "serviceAccountJson",
            "${{ steps.auth.outputs.credentials_file_path }}",
        ))
        .add_with(("packageName", "com.macro.workspace.mobile"))
        .add_with(("releaseFiles", "${{ steps.artifact.outputs.bundle }}"))
        .add_with(("mappingFile", "${{ steps.artifact.outputs.mapping }}"))
        .add_with(("releaseName", "${{ needs.check.outputs.release_name }}"))
        .add_with(("track", "internal"))
        .add_with(("status", "completed"))
        .add_with(("whatsNewDirectory", "${{ runner.temp }}/whatsnew"))
}

/// Set before the promotion starts, so a drift check running meanwhile
/// treats the version code as possibly promoted.
fn mark_promotion_pending() -> Step<Run> {
    Step::new("Mark the promotion as started")
        .run(concat!(
            include_str!("scripts/android_play_statuses.sh"),
            indoc::indoc! {r#"
                set -euo pipefail
                set_commit_status "$BUILT_SHA" android-play/release pending \
                  "$(android_release_description "$VERSION_CODE" "$NATIVE_HASH")"
            "#}
        ))
        .id("pending")
        .shell("bash")
        .add_env(("NATIVE_HASH", "${{ steps.stamp.outputs.native_hash }}"))
}

/// Internal → production, full rollout. Play can take a moment to show the
/// internal release in a fresh edit, so the promotion is retried briefly.
fn promote_production() -> Step<Run> {
    steps::logged_run(
        "Promote to production",
        indoc::indoc! {r#"
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
        "#},
    )
    .id("promote")
    .working_directory(xtask_paths::repo_dir!("apps/web"))
    .add_env(("GOOGLE_PLAY_ACCESS_TOKEN", "${{ steps.auth.outputs.access_token }}"))
    .add_env(("CHANGES_NOT_SENT_FOR_REVIEW", "false"))
}

/// Success, or failure for a promotion that failed or was cancelled midway
/// (the drift check treats failure as "may be promoted").
fn mark_promotion_result() -> Step<Run> {
    Step::new("Record the promotion result")
        .run(concat!(
            include_str!("scripts/android_play_statuses.sh"),
            indoc::indoc! {r#"
                set -euo pipefail
                state=failure
                if [[ "$PROMOTE_OUTCOME" == success ]]; then
                  state=success
                fi
                set_commit_status "$BUILT_SHA" android-play/release "$state" \
                  "$(android_release_description "$VERSION_CODE" "$NATIVE_HASH")"
            "#}
        ))
        .if_condition(Expression::new(
            "always() && steps.pending.outcome == 'success'",
        ))
        .shell("bash")
        .add_env(("NATIVE_HASH", "${{ steps.stamp.outputs.native_hash }}"))
        .add_env(("PROMOTE_OUTCOME", "${{ steps.promote.outcome }}"))
}

fn pr_comment() -> Step<Use> {
    Step::new("Comment on the PR")
        .uses(
            "actions",
            "github-script",
            "f28e40c7f34bde8b3046d885e986cb6290c5673b",
        )
        .if_condition(Expression::new("success() || failure()"))
        .add_with(("github-token", "${{ secrets.GITHUB_TOKEN }}"))
        .add_env(("JOB_NAME", PUBLISH_JOB_NAME))
        .add_env(("BUILD_URL", "${{ github.event.workflow_run.html_url }}"))
        .add_env(("RELEASE_NAME", "${{ needs.check.outputs.release_name }}"))
        .add_env(("JOB_STATUS", "${{ job.status }}"))
        .add_env(("UPLOAD_OUTCOME", "${{ steps.upload.outcome }}"))
        .add_with((
            "script",
            include_str!("scripts/android_play_publish_comment.js"),
        ))
}
