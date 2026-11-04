//! `Android Release Drift` — runs on every push to a PR that carries the
//! `android-update` label, i.e. a PR whose Android bundle is (or is about to
//! be) on Google Play. Web-only pushes are fine: the embedded web bundle is
//! replaced over the air after the merge. Native pushes make the bundle
//! stale, so when the Android native code changed this workflow:
//!
//! 1. cancels any [`super::android_play_release`] run still building the
//!    old head and waits for it to stop,
//! 2. removes the `android-update` label (which also stops
//!    [`super::android_release_watch`] watching the PR), and
//! 3. comments what to do: bump, commit, re-add the label.
//!
//! Unlike App Store review, a Play production release cannot be withdrawn
//! once submitted: if the stale bundle was already promoted, the comment
//! says so loudly and the follow-up should ship as soon as possible. This
//! job runs the PR's code, so it cannot ask Play; it reads the
//! `android-play/release` commit status [`super::android_play_publish`] sets
//! around the promotion, after waiting for publish runs in progress. The
//! production status remains unknown when the prior native tree cannot be
//! verified, a promotion may have happened (pending or failed), or the
//! lookup fails.
//! The iOS counterpart is [`super::ios_release_drift`].

use gh_workflow::{
    Event, Expression, Job, Level, Permissions, PullRequest, PullRequestType, Run, Step, Use,
    Workflow,
};

use crate::workflows::{runners, steps};

#[cfg(test)]
mod test;

const CHANGED: &str = "steps.detect.outputs.changed == 'true'";

/// Build the workflow.
pub fn android_release_drift() -> Workflow {
    Workflow::new("Android Release Drift")
        .on(Event::default()
            .pull_request(PullRequest::default().add_type(PullRequestType::Synchronize)))
        .add_job("drift", drift_job())
}

fn drift_job() -> Job {
    Job::default()
        .name("Android Release Drift")
        .cond(Expression::new(
            "contains(github.event.pull_request.labels.*.name, 'android-update') && \
             github.event.pull_request.head.repo.full_name == github.repository",
        ))
        .runs_on(runners::Runner::TinyNoCache.to_string())
        // Cancelling release runs waits up to 3 minutes, publish runs in
        // progress up to 10.
        .timeout_minutes(20u32)
        .permissions(
            Permissions::default()
                .actions(Level::Write)
                .contents(Level::Read)
                .pull_requests(Level::Write)
                .statuses(Level::Read),
        )
        .add_env(("GH_TOKEN", "${{ github.token }}"))
        .add_env(("GH_REPO", "${{ github.repository }}"))
        .add_env(("PR_NUMBER", "${{ github.event.pull_request.number }}"))
        .add_step(steps::checkout(false, false))
        .add_step(setup_bun())
        .add_step(detect())
        .add_step(cancel_release_runs())
        .add_step(play_status())
        .add_step(remove_label())
        .add_step(comment())
}

fn changed() -> Expression {
    Expression::new(CHANGED)
}

fn setup_bun() -> Step<Use> {
    steps::setup_bun_pinned()
}

fn detect() -> Step<Run> {
    Step::new("Detect Android native changes in this push")
        .run(concat!(
            include_str!("scripts/android_git_fetch.sh"),
            include_str!("scripts/android_release_drift.sh")
        ))
        .id("detect")
        .shell("bash")
        .working_directory(xtask_paths::repo_dir!("apps/web"))
        .add_env(("BEFORE_SHA", "${{ github.event.before }}"))
        .add_env(("AFTER_SHA", "${{ github.event.after }}"))
}

fn cancel_release_runs() -> Step<Run> {
    Step::new("Cancel in-progress release runs for this PR")
        .run(indoc::indoc! {r#"
            set -euo pipefail
            runs=$(gh run list --repo "$GH_REPO" --workflow android-play-release.yml \
              --branch "$HEAD_REF" --json databaseId,status \
              --jq '.[] | select(.status == "queued" or .status == "in_progress" or .status == "waiting") | .databaseId')
            if [[ -z "$runs" ]]; then
              echo "No release run in progress."
              exit 0
            fi
            for run_id in $runs; do
              echo "Cancelling release run ${run_id} (it would upload a bundle of the old head)."
              gh run cancel "$run_id" --repo "$GH_REPO" || true
            done
            deadline=$(( $(date +%s) + 180 ))
            for run_id in $runs; do
              while [[ "$(gh run view "$run_id" --repo "$GH_REPO" --json status --jq .status)" != "completed" ]]; do
                if (( $(date +%s) > deadline )); then
                  echo "::warning::Release run ${run_id} is still not completed."
                  break
                fi
                sleep 10
              done
            done
        "#})
        .if_condition(changed())
        .shell("bash")
        .add_env(("HEAD_REF", "${{ github.event.pull_request.head.ref }}"))
}

/// Was the stale bundle already promoted to production (in review or
/// published)? Nothing can withdraw it then.
fn play_status() -> Step<Run> {
    Step::new("Check whether the stale version code was submitted to production")
        .run(concat!(
            include_str!("scripts/android_play_statuses.sh"),
            include_str!("scripts/android_release_drift_promoted.sh")
        ))
        .id("status")
        .if_condition(Expression::new(format!(
            "{CHANGED} && steps.detect.outputs.version_code != ''"
        )))
        .shell("bash")
        .add_env(("BEFORE_SHA", "${{ github.event.before }}"))
        .add_env(("VERSION_CODE", "${{ steps.detect.outputs.version_code }}"))
}

/// `always()`: even if the status check failed, the label must come off and
/// someone must be told.
fn after_detect() -> Expression {
    Expression::new(format!("always() && {CHANGED}"))
}

fn remove_label() -> Step<Run> {
    Step::new("Remove the android-update label")
        .run("gh pr edit \"$PR_NUMBER\" --repo \"$GH_REPO\" --remove-label android-update")
        .if_condition(after_detect())
        .shell("bash")
}

fn comment() -> Step<Run> {
    Step::new("Comment on the PR")
        .run(indoc::indoc! {r#"
            set -euo pipefail
            bump='cd apps/web && just android-bump'
            if [[ "$PROMOTED" == "true" ]]; then
              body="🚨 Android native changes were pushed to this PR after version code ${VERSION_CODE} had already been promoted to Google Play production, so that bundle is (or is about to be) live with native code this PR no longer matches. A Play release cannot be withdrawn: bump (\`${bump}\`), commit, re-add the \`android-update\` label, and ship the follow-up as soon as possible. The label was removed."
            elif [[ "$PROMOTED" == "false" ]]; then
              body="🤖 Android native code changed after this PR's Play release started. Android Play Publish did not submit version code ${VERSION_CODE} to production. The \`android-update\` label was removed; any bundle on the internal track remains there for testers. Once in-progress release runs have stopped and the PR is ready again, bump (\`${bump}\`), commit, push, and re-add \`android-update\`."
            else
              body="⚠️ Android native code changed or could not be compared with this PR's prior release, and whether that release was submitted to Google Play production could not be determined. The prior bundle may already be in review or live. The \`android-update\` label was removed. Check the production track in Play Console, and treat the prior release as potentially live until you have."
            fi
            gh pr comment "$PR_NUMBER" --repo "$GH_REPO" --body "$body"
        "#})
        .if_condition(after_detect())
        .shell("bash")
        .add_env(("PROMOTED", "${{ steps.status.outputs.promoted }}"))
        .add_env(("VERSION_CODE", "${{ steps.detect.outputs.version_code }}"))
}
