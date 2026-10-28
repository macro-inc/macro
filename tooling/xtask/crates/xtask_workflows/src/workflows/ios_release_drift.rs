//! `iOS Release Drift` — runs on every push to a PR that carries the
//! `ios-update` label, i.e. a PR whose iOS build is (or is about to be) in
//! App Review. Web-only pushes are fine: the embedded web bundle is replaced
//! over the air after the merge. Native pushes make the uploaded build
//! stale, and with release type "after approval" a stale build Apple approves
//! goes straight to the App Store — so when `apps/web/tauri` changed this
//! workflow:
//!
//! 1. cancels any [`super::ios_app_store_release`] run still building the
//!    old head and waits for it to stop,
//! 2. withdraws the PR's submission from review in App Store Connect
//!    (`ios-app-store.mjs withdraw`, found by the PR number in the build
//!    stamp) so nothing stale can go live,
//! 3. removes the `ios-update` label (which also stops
//!    [`super::ios_release_watch`] watching the PR), and
//! 4. comments what to do: bump, commit, re-add the label. The re-release
//!    keeps the marketing version and `submit` takes the withdrawn version
//!    record over.
//!
//! If Apple had already approved or released the stale build there is
//! nothing to withdraw; the comment then says so loudly.

use gh_workflow::{
    Event, Expression, Job, Level, Permissions, PullRequest, PullRequestType, Run, Step, Use,
    Workflow,
};

use crate::workflows::{runners, steps, vars};

const CHANGED: &str = "steps.detect.outputs.changed == 'true'";

/// Build the workflow.
pub fn ios_release_drift() -> Workflow {
    Workflow::new("iOS Release Drift")
        .on(Event::default()
            .pull_request(PullRequest::default().add_type(PullRequestType::Synchronize)))
        .add_job("drift", drift_job())
}

fn drift_job() -> Job {
    Job::default()
        .name("iOS Release Drift")
        .cond(Expression::new(
            "contains(github.event.pull_request.labels.*.name, 'ios-update') && \
             github.event.pull_request.head.repo.full_name == github.repository",
        ))
        .runs_on(runners::Runner::TinyNoCache.to_string())
        .timeout_minutes(15u32)
        .permissions(
            Permissions::default()
                .actions(Level::Write)
                .contents(Level::Read)
                .pull_requests(Level::Write),
        )
        .add_env(("GH_TOKEN", "${{ github.token }}"))
        .add_env(("GH_REPO", "${{ github.repository }}"))
        .add_env(("PR_NUMBER", "${{ github.event.pull_request.number }}"))
        .add_step(steps::checkout(false, false))
        .add_step(detect())
        .add_step(cancel_release_runs())
        .add_step(setup_bun())
        .add_step(fetch_credentials())
        .add_step(withdraw())
        .add_step(remove_label())
        .add_step(comment())
}

fn changed() -> Expression {
    Expression::new(CHANGED)
}

fn detect() -> Step<Run> {
    Step::new("Detect native changes in this push")
        .run(concat!(
            include_str!("scripts/ios_native_tree.sh"),
            include_str!("scripts/ios_release_drift.sh")
        ))
        .id("detect")
        .shell("bash")
        .add_env(("BEFORE_SHA", "${{ github.event.before }}"))
        .add_env(("AFTER_SHA", "${{ github.event.after }}"))
}

fn cancel_release_runs() -> Step<Run> {
    Step::new("Cancel in-progress release runs for this PR")
        .run(indoc::indoc! {r#"
            set -euo pipefail
            runs=$(gh run list --repo "$GH_REPO" --workflow ios-app-store-release.yml \
              --branch "$HEAD_REF" --json databaseId,status \
              --jq '.[] | select(.status == "queued" or .status == "in_progress" or .status == "waiting") | .databaseId')
            if [[ -z "$runs" ]]; then
              echo "No release run in progress."
              exit 0
            fi
            for run_id in $runs; do
              echo "Cancelling release run ${run_id} (it would upload a build of the old head)."
              gh run cancel "$run_id" --repo "$GH_REPO" || true
            done
            # Wait for them to stop: a run already inside `submit` could
            # otherwise submit after the withdrawal below looked for nothing.
            deadline=$(( $(date +%s) + 180 ))
            for run_id in $runs; do
              while [[ "$(gh run view "$run_id" --repo "$GH_REPO" --json status --jq .status)" != "completed" ]]; do
                if (( $(date +%s) > deadline )); then
                  echo "::warning::Release run ${run_id} is still not completed; withdrawing anyway."
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

fn setup_bun() -> Step<Use> {
    Step::new("Setup Bun")
        .uses(
            "oven-sh",
            "setup-bun",
            "0c5077e51419868618aeaa5fe8019c62421857d6",
        ) // v2.2.0
        .if_condition(changed())
        .add_with(("bun-version", "1.3.13"))
}

fn fetch_credentials() -> Step<Run> {
    Step::new("Fetch App Store Connect credentials from Doppler")
        .run(include_str!("scripts/ios_app_store_connect_credentials.sh"))
        .shell("bash")
        .if_condition(changed())
        .add_env(("DOPPLER_TOKEN", vars::IOS_RELEASE_DOPPLER_TOKEN))
}

fn withdraw() -> Step<Run> {
    Step::new("Withdraw the PR's App Store submission")
        .run("bun scripts/ios-app-store.mjs withdraw --pr \"$PR_NUMBER\"")
        .id("withdraw")
        .if_condition(changed())
        .working_directory(xtask_paths::repo_dir!("apps/web"))
}

/// `always()`: even if the withdrawal call failed (App Store Connect or
/// Doppler hiccup), the label must come off and someone must be told —
/// otherwise the stale build stays in review unnoticed.
fn after_withdraw() -> Expression {
    Expression::new(format!("always() && {CHANGED}"))
}

fn remove_label() -> Step<Run> {
    Step::new("Remove the ios-update label")
        .run("gh pr edit \"$PR_NUMBER\" --repo \"$GH_REPO\" --remove-label ios-update")
        .if_condition(after_withdraw())
        .shell("bash")
}

fn comment() -> Step<Run> {
    Step::new("Comment on the PR")
        .run(indoc::indoc! {r#"
            set -euo pipefail
            bump='cd apps/web && doppler run --project ios-release --config prd -- just ios-bump'
            if [[ "$WITHDRAW_OUTCOME" != "success" ]]; then
              body="🚨 Native changes were pushed to this PR after its App Store release started, but withdrawing the App Review submission **failed** (see the [workflow run](${RUN_URL})). If a submission is pending, remove it from review in App Store Connect by hand so the stale build cannot go live. The \`ios-update\` label was removed; when the PR is ready again, bump (\`${bump}\`), commit, push, and re-add \`ios-update\`."
            elif [[ -n "$LIVE" ]]; then
              body="🚨 Native changes were pushed to this PR after Apple had already approved iOS ${LIVE}, so that build is (or is about to be) live with native code this PR no longer matches. Bump (\`${bump}\`), commit, re-add the \`ios-update\` label, and ship the follow-up as soon as possible. The label was removed."
            else
              body="📱 Native code changed after this PR's App Store release started, so the release was stopped: any in-progress build was cancelled and any pending App Review submission withdrawn (nothing stale can go live), and the \`ios-update\` label was removed. When the PR is ready again, bump (\`${bump}\`; the marketing version stays, the build number moves), commit, push, and re-add \`ios-update\`."
            fi
            gh pr comment "$PR_NUMBER" --repo "$GH_REPO" --body "$body"
        "#})
        .if_condition(after_withdraw())
        .shell("bash")
        .add_env(("LIVE", "${{ steps.withdraw.outputs.live }}"))
        .add_env(("WITHDRAW_OUTCOME", "${{ steps.withdraw.outcome }}"))
        .add_env((
            "RUN_URL",
            "${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}",
        ))
}
