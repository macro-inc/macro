//! `CI Gate Sweep` — every ten minutes, closes each `CI gate` request nothing
//! else will, so the required status never stays pending on a run that isn't
//! coming. Generated into `ci-gate-sweep.yml`.
//!
//! The other gate workflows close a request only if GitHub starts and finishes
//! their run. A `run-ci` label can start nothing: GitHub dropped the event, or
//! the PR began to conflict after `ci_gate_label` looked. A cancelled
//! [`pr_ci`](crate::workflows::pr_ci) run skips its gate job. The sweep removes
//! a label left on a PR and fails a `Running on` status whose run has ended,
//! each with the command to run CI again. It leaves `Not run on this commit`
//! alone: nobody asked for that run.

use gh_workflow::{
    Concurrency, Event, Expression, Job, Level, Permissions, Schedule, Workflow, WorkflowDispatch,
};

use crate::workflows::pr_ci;

/// Build the workflow.
pub fn ci_gate_sweep() -> Workflow {
    Workflow::new("CI Gate Sweep")
        .on(Event::default()
            .add_schedule(Schedule::new("*/10 * * * *"))
            .workflow_dispatch(WorkflowDispatch::default()))
        .concurrency(Concurrency::new(Expression::new("ci-gate-sweep")))
        .add_job("sweep", sweep())
}

/// GitHub's hosted runner, so the sweep still runs when Namespace doesn't.
fn sweep() -> Job {
    Job::default()
        .name("Close CI gate requests that got no run")
        .runs_on("ubuntu-latest")
        .timeout_minutes(10u32)
        .permissions(Permissions {
            actions: Some(Level::Read),
            contents: Some(Level::Read),
            issues: Some(Level::Write),
            pull_requests: Some(Level::Write),
            statuses: Some(Level::Write),
            ..Default::default()
        })
        .add_step(
            pr_ci::gate_step("Sweep open pull requests", "sweep")
                .add_env(("CI_GATE_DOCS_URL", pr_ci::GATE_DOCS_URL)),
        )
}
