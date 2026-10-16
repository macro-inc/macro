//! `iOS Release Watch` — half-hourly cron closing the loop of the `iOS
//! Native Check` gate (a job of [`super::web_app_check_main`]): that check
//! fails on a PR with breaking native changes until the matching iOS version
//! is live on the App Store, and nothing on GitHub's side notices when Apple
//! releases it. This workflow looks at every open PR labeled `ios-update`
//! (the label that started the [`super::ios_app_store_release`] run), asks
//! App Store Connect whether the version + build committed at the PR head is
//! live (built from the native tree of the PR's merge result, like the gate
//! checks), and when it is, re-runs the PR's failed `iOS Native Check` job so
//! the gate turns green on its own. Re-running an existing job is how this
//! stays within GitHub's rule that events created with the workflow token
//! never start workflows.
//!
//! It also backs up [`super::ios_release_drift`]: GitHub does not run
//! pull_request workflows on a PR that conflicts with main, so a native push
//! to such a PR is only noticed here — the in-flight build's stamp is
//! compared with the head's native code and a stale submission withdrawn.
//!
//! Credentials come from Doppler like the other two iOS workflows; the
//! common case (no labeled PRs) exits before fetching anything.

use gh_workflow::{
    Event, Expression, Job, Level, Permissions, Run, Schedule, Step, Use, Workflow,
    WorkflowDispatch,
};

use crate::workflows::{runners, steps, vars};

/// `true` when the first step found at least one PR to look at.
const HAS_PRS: &str = "steps.prs.outputs.count != '0'";

/// Build the workflow.
pub fn ios_release_watch() -> Workflow {
    Workflow::new("iOS Release Watch")
        .on(Event::default()
            .add_schedule(Schedule::new("*/30 * * * *"))
            .workflow_dispatch(WorkflowDispatch::default()))
        .permissions(
            Permissions::default()
                .actions(Level::Write)
                .contents(Level::Read)
                .pull_requests(Level::Write),
        )
        .add_job("watch", watch_job())
}

fn watch_job() -> Job {
    Job::default()
        .name("Re-run the iOS Native Check once the App Store release is live")
        .runs_on(runners::Runner::TinyNoCache.to_string())
        .timeout_minutes(15u32)
        .add_env(("GH_TOKEN", "${{ github.token }}"))
        .add_env(("GH_REPO", "${{ github.repository }}"))
        .add_step(find_prs())
        .add_step(steps::checkout(false, false).if_condition(gated()))
        .add_step(setup_bun())
        .add_step(fetch_credentials())
        .add_step(rerun_live_checks())
}

fn gated() -> Expression {
    Expression::new(HAS_PRS)
}

fn find_prs() -> Step<Run> {
    Step::new("Find PRs waiting on an App Store release")
        .run(indoc::indoc! {r#"
            set -euo pipefail
            prs=$(gh pr list --repo "$GH_REPO" --label ios-update --state open \
              --json number,headRefOid,potentialMergeCommit \
              --jq 'map({number, sha: .headRefOid, merge: .potentialMergeCommit.oid})' | jq -c .)
            count=$(jq 'length' <<<"$prs")
            echo "Open PRs labeled ios-update: ${count}"
            echo "prs=${prs}" >> "$GITHUB_OUTPUT"
            echo "count=${count}" >> "$GITHUB_OUTPUT"
        "#})
        .id("prs")
        .shell("bash")
}

fn setup_bun() -> Step<Use> {
    Step::new("Setup Bun")
        .uses(
            "oven-sh",
            "setup-bun",
            "0c5077e51419868618aeaa5fe8019c62421857d6",
        ) // v2.2.0
        .if_condition(gated())
        .add_with(("bun-version", "1.3.13"))
}

fn fetch_credentials() -> Step<Run> {
    Step::new("Fetch App Store Connect credentials from Doppler")
        .run(include_str!("scripts/ios_app_store_connect_credentials.sh"))
        .shell("bash")
        .if_condition(gated())
        .add_env(("DOPPLER_TOKEN", vars::IOS_RELEASE_DOPPLER_TOKEN))
}

fn rerun_live_checks() -> Step<Run> {
    Step::new("Re-run the check on PRs whose release is live")
        .run(concat!(
            include_str!("scripts/ios_native_tree.sh"),
            include_str!("scripts/ios_release_watch.sh")
        ))
        .shell("bash")
        .if_condition(gated())
        .add_env(("PRS", "${{ steps.prs.outputs.prs }}"))
}
