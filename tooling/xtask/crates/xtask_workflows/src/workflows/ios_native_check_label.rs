//! `iOS Native Check Label` — re-runs the `iOS Native Check` job of the web
//! app PR checks when the `skip-ios-update` label is added to or removed from
//! a PR. The gate lives in that workflow (so the required `Web App Status
//! Check` covers it), and re-running the whole web suite on every label
//! event would be wasteful, so this re-runs just the one job; GitHub re-runs
//! the status check that depends on it. A run still in progress saw the
//! labels as they were when it started, so it is waited for first; a run
//! cancelled by a later push, or a head that has since moved, is left alone
//! (the newer run reads the labels itself). This job is not a required
//! check: it can take up to 25 minutes while waiting, and the release
//! preconditions ignore it.

use gh_workflow::{
    Event, Expression, Job, Level, Permissions, PullRequest, PullRequestType, Step, Workflow,
};

use crate::workflows::runners;

/// Build the workflow.
pub fn ios_native_check_label() -> Workflow {
    Workflow::new("iOS Native Check Label")
        .on(Event::default().pull_request(
            PullRequest::default()
                .add_branch("main")
                .add_type(PullRequestType::Labeled)
                .add_type(PullRequestType::Unlabeled),
        ))
        .add_job("rerun", rerun_job())
}

fn rerun_job() -> Job {
    Job::default()
        .name("Re-run the iOS Native Check")
        // Fork PRs get a read-only token, which cannot re-run jobs.
        .cond(Expression::new(
            "github.event.label.name == 'skip-ios-update' && \
             github.event.pull_request.head.repo.full_name == github.repository",
        ))
        .runs_on(runners::Runner::TinyNoCache.to_string())
        .timeout_minutes(30u32)
        .permissions(
            Permissions::default()
                .actions(Level::Write)
                .pull_requests(Level::Read),
        )
        .add_env(("GH_TOKEN", "${{ github.token }}"))
        .add_env(("GH_REPO", "${{ github.repository }}"))
        .add_env(("HEAD_SHA", "${{ github.event.pull_request.head.sha }}"))
        .add_env(("PR_NUMBER", "${{ github.event.pull_request.number }}"))
        .add_step(
            Step::new("Re-run the gate job for this head")
                .run(include_str!("scripts/ios_native_check_rerun.sh"))
                .shell("bash"),
        )
}
