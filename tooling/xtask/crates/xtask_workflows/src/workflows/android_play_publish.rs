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

use gh_workflow::expr::typed::{
    Flag, JobHandle, JobOutput, StepHandle, StepOutput, Str, always, failure, github, job_status,
    runner, success,
};
use gh_workflow::{
    Concurrency, Event, Job, Level, Permissions, Run, Step, Use, Workflow, WorkflowRun,
    WorkflowRunType,
};

use crate::workflows::actions::{
    ActionsDownloadArtifact, ActionsGithubScript, R0adkllUploadGooglePlay,
};
use crate::workflows::{runners, steps, vars};

#[cfg(test)]
mod test;

/// The `publish` job's name, which its failure comment looks up.
const PUBLISH_JOB_NAME: &str = "Android Play Publish";

struct CheckOutputs {
    /// Whether a build is to be published.
    publish: JobOutput<Flag>,
    /// The PR the build was made for.
    pr_number: JobOutput<Str>,
    /// The build's version code.
    version_code: JobOutput<Str>,
    /// The Play release name for the build.
    release_name: JobOutput<Str>,
}

/// The `check` job, which `publish` waits on.
const CHECK: JobHandle<CheckOutputs> = JobHandle::new(
    "check",
    CheckOutputs {
        publish: JobOutput::new("check", "publish"),
        pr_number: JobOutput::new("check", "pr_number"),
        version_code: JobOutput::new("check", "version_code"),
        release_name: JobOutput::new("check", "release_name"),
    },
);

struct VerifyOutputs {
    /// Whether to publish, behind `CHECK.outputs.publish`.
    publish: StepOutput<Flag>,
    pr_number: StepOutput<Str>,
    version_code: StepOutput<Str>,
    release_name: StepOutput<Str>,
}

/// The [`verify`] step, whose outputs become [`CHECK`]'s.
const VERIFY: StepHandle<VerifyOutputs> = StepHandle::new(
    "verify",
    VerifyOutputs {
        publish: StepOutput::new("verify", "publish"),
        pr_number: StepOutput::new("verify", "pr_number"),
        version_code: StepOutput::new("verify", "version_code"),
        release_name: StepOutput::new("verify", "release_name"),
    },
);

struct StampOutputs {
    /// The native tree hash, from main's hashing script.
    native_hash: StepOutput<Str>,
}

/// The [`provenance_stamp`] step.
const STAMP: StepHandle<StampOutputs> = StepHandle::new(
    "stamp",
    StampOutputs {
        native_hash: StepOutput::new("stamp", "native_hash"),
    },
);

struct PickFilesOutputs {
    /// The App Bundle's path.
    bundle: StepOutput<Str>,
    /// The R8 mapping's path.
    mapping: StepOutput<Str>,
}

/// The [`pick_files`] step.
const PICK_FILES: StepHandle<PickFilesOutputs> = StepHandle::new(
    "artifact",
    PickFilesOutputs {
        bundle: StepOutput::new("artifact", "bundle"),
        mapping: StepOutput::new("artifact", "mapping"),
    },
);

/// The [`upload_internal`] step.
const UPLOAD: StepHandle<()> = StepHandle::new("upload", ());
/// The [`mark_promotion_pending`] step.
const PENDING: StepHandle<()> = StepHandle::new("pending", ());
/// The [`promote_production`] step.
const PROMOTE: StepHandle<()> = StepHandle::new("promote", ());

/// Build the workflow.
pub fn android_play_publish() -> Workflow {
    Workflow::new("Android Play Publish")
        .on(Event::default().workflow_run(
            WorkflowRun::default()
                .add_type(WorkflowRunType::Completed)
                .add_workflow("Android Play Release"),
        ))
        .add_job(CHECK, check_job())
        .add_job("publish", publish_job())
}

fn check_job() -> Job {
    Job::default()
        .name("Check the release request")
        // The build job skips fork PRs, and fork runs never get here with a
        // successful build; the head-repository test is belt and braces.
        .cond(
            github()
                .event::<Str>("workflow_run.conclusion")
                .eq("success")
                .and(
                    github()
                        .event::<Str>("workflow_run.event")
                        .eq("pull_request"),
                )
                .and(
                    github()
                        .event::<Str>("workflow_run.head_repository.full_name")
                        .eq(github().repository()),
                ),
        )
        .runs_on(runners::Runner::TinyNoCache.to_string())
        .timeout_minutes(10u32)
        .permissions(
            Permissions::default()
                .actions(Level::Read)
                .contents(Level::Read)
                .issues(Level::Read)
                .pull_requests(Level::Write),
        )
        .add_env(("GH_TOKEN", github().token()))
        .add_env(("GH_REPO", github().repository()))
        .add_output(CHECK.outputs.publish.name(), VERIFY.outputs.publish.read())
        .add_output(
            CHECK.outputs.pr_number.name(),
            VERIFY.outputs.pr_number.read(),
        )
        .add_output(
            CHECK.outputs.version_code.name(),
            VERIFY.outputs.version_code.read(),
        )
        .add_output(
            CHECK.outputs.release_name.name(),
            VERIFY.outputs.release_name.read(),
        )
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
    .id(VERIFY.id())
    .working_directory(xtask_paths::repo_dir!("apps/web"))
    .add_env(("RUN_ID", github().event::<Str>("workflow_run.id")))
    .add_env((
        "RUN_ATTEMPT",
        github().event::<Str>("workflow_run.run_attempt"),
    ))
    .add_env(("RUN_PATH", github().event::<Str>("workflow_run.path")))
    .add_env((
        "RUN_ACTOR",
        github().event::<Str>("workflow_run.actor.login"),
    ))
    .add_env((
        "RUN_CREATED_AT",
        github().event::<Str>("workflow_run.created_at"),
    ))
    .add_env(("HEAD_SHA", github().event::<Str>("workflow_run.head_sha")))
    .add_env((
        "HEAD_BRANCH",
        github().event::<Str>("workflow_run.head_branch"),
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
        .if_condition(failure().and(VERIFY.outputs.pr_number.read().ne("")))
        .shell("bash")
        .add_env(("PR_NUMBER", VERIFY.outputs.pr_number.read()))
        .add_env(("BUILD_URL", github().event::<Str>("workflow_run.html_url")))
        .add_env((
            "RUN_URL",
            format!(
                "{}/{}/actions/runs/{}",
                github().server_url(),
                github().repository(),
                github().run_id()
            ),
        ))
}

fn publish_job() -> Job {
    Job::default()
        .name(PUBLISH_JOB_NAME)
        .add_needs(CHECK)
        .cond(CHECK.outputs.publish.read().is_set())
        // A hosted image: the upload action and the promotion script need Node.
        .runs_on("ubuntu-24.04")
        .timeout_minutes(30u32)
        // One release at a time per PR branch, queued rather than cancelled:
        // a cancelled run can leave a promotion half-reported.
        .concurrency(Concurrency::new(format!(
            "android-play-publish-{}",
            github().event::<Str>("workflow_run.head_branch")
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
        .add_env(("GH_TOKEN", github().token()))
        .add_env(("GH_REPO", github().repository()))
        .add_env(("PR_NUMBER", CHECK.outputs.pr_number.read()))
        .add_env(("VERSION_CODE", CHECK.outputs.version_code.read()))
        .add_env(("BUILT_SHA", github().event::<Str>("workflow_run.head_sha")))
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
    .id(STAMP.id())
    .working_directory(xtask_paths::repo_dir!("apps/web"))
}

fn download_artifact() -> Step<Use> {
    ActionsDownloadArtifact::new("Download the built App Bundle")
        .name("android-release")
        .run_id(github().event::<Str>("workflow_run.id"))
        .github_token(github().token())
        .path(format!("{}/android-release", runner().temp()))
        .step()
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
    .id(PICK_FILES.id())
}

fn upload_internal() -> Step<Use> {
    R0adkllUploadGooglePlay::new("Upload to internal testing", "com.macro.workspace.mobile")
        .service_account_json(steps::GOOGLE_PLAY_AUTH.outputs.credentials_file_path.read())
        .release_files(PICK_FILES.outputs.bundle.read())
        .mapping_file(PICK_FILES.outputs.mapping.read())
        .release_name(CHECK.outputs.release_name.read())
        .track("internal")
        .status("completed")
        .whats_new_directory(format!("{}/whatsnew", runner().temp()))
        .step()
        .id(UPLOAD.id())
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
        .id(PENDING.id())
        .shell("bash")
        .add_env(("NATIVE_HASH", STAMP.outputs.native_hash.read()))
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
    .id(PROMOTE.id())
    .working_directory(xtask_paths::repo_dir!("apps/web"))
    .add_env(("GOOGLE_PLAY_ACCESS_TOKEN", steps::GOOGLE_PLAY_AUTH.outputs.access_token.read()))
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
        .if_condition(always().and(PENDING.outcome().eq("success")))
        .shell("bash")
        .add_env(("NATIVE_HASH", STAMP.outputs.native_hash.read()))
        .add_env(("PROMOTE_OUTCOME", PROMOTE.outcome()))
}

fn pr_comment() -> Step<Use> {
    ActionsGithubScript::new(
        "Comment on the PR",
        include_str!("scripts/android_play_publish_comment.js"),
    )
    .github_token(vars::GITHUB_TOKEN)
    .step()
    .if_condition(success().or(failure()))
    .add_env(("JOB_NAME", PUBLISH_JOB_NAME))
    .add_env(("BUILD_URL", github().event::<Str>("workflow_run.html_url")))
    .add_env(("RELEASE_NAME", CHECK.outputs.release_name.read()))
    .add_env(("JOB_STATUS", job_status()))
    .add_env(("UPLOAD_OUTCOME", UPLOAD.outcome()))
}
