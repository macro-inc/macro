//! `iOS Release Watch` — half-hourly cron closing the loop of the `iOS
//! Native Check` gate (a job of [`super::web_app_check_main`]): that check
//! fails on a PR with breaking native changes until Apple approves the
//! matching iOS version, and nothing on GitHub's side notices when Apple
//! does. This workflow looks at every open PR labeled `ios-update` (the label
//! that started the [`super::ios_app_store_release`] run), asks App Store
//! Connect whether Apple approved the version + build committed at the PR
//! head (built from the native tree of the PR's merge result, like the gate
//! checks), and when it did, re-runs failed `iOS Native Check` jobs from PR CI
//! and the earlier standalone web workflow on that head so
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

use gh_workflow::expr::typed::{Bool, Expr, StepHandle, StepOutput, Str, github};
use gh_workflow::{
    Event, Job, Level, Permissions, Run, Schedule, Step, Use, Workflow, WorkflowDispatch,
};

use crate::workflows::actions::OvenShSetupBun;
use crate::workflows::{runners, steps, vars};

#[cfg(test)]
mod test;

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
        .name("Re-run the iOS Native Check once Apple approves the App Store release")
        .runs_on(runners::Runner::TinyNoCache.to_string())
        .timeout_minutes(15u32)
        .add_env(("GH_TOKEN", github().token()))
        .add_env(("GH_REPO", github().repository()))
        .add_step(find_prs())
        .add_step(steps::checkout(false, false).if_condition(gated()))
        .add_step(setup_bun())
        .add_step(fetch_credentials())
        .add_step(rerun_approved_checks())
}

/// `true` when the first step found at least one PR to look at.
fn gated() -> Expr<Bool> {
    FIND_PRS.outputs.count.read().ne("0")
}

struct FindPrsOutputs {
    /// The open PRs found, as a JSON array of `{number, sha, merge}`.
    prs: StepOutput<Str>,
    /// How many PRs `prs` holds.
    count: StepOutput<Str>,
}

/// The [`find_prs`] step.
const FIND_PRS: StepHandle<FindPrsOutputs> = StepHandle::new(
    "prs",
    FindPrsOutputs {
        prs: StepOutput::new("prs", "prs"),
        count: StepOutput::new("prs", "count"),
    },
);

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
        .id(FIND_PRS.id())
        .shell("bash")
}

fn setup_bun() -> Step<Use> {
    OvenShSetupBun::new("Setup Bun")
        .bun_version("1.3.13")
        .step()
        .if_condition(gated())
}

fn fetch_credentials() -> Step<Run> {
    Step::new("Fetch App Store Connect credentials from Doppler")
        .run(include_str!("scripts/ios_app_store_connect_credentials.sh"))
        .shell("bash")
        .if_condition(gated())
        .add_env(("DOPPLER_TOKEN", vars::IOS_RELEASE_DOPPLER_TOKEN))
}

fn rerun_approved_checks() -> Step<Run> {
    Step::new("Re-run the check on PRs whose release Apple approved")
        .run(concat!(
            include_str!("scripts/ios_native_tree.sh"),
            include_str!("scripts/pr_ci_run.sh"),
            include_str!("scripts/ios_release_watch.sh")
        ))
        .shell("bash")
        .if_condition(gated())
        .add_env(("PRS", FIND_PRS.outputs.prs.read()))
}
