//! `CI Gate for Forks` — after a fork PR's `PR CI` run, removes the label and
//! sets the `CI gate` status, which the fork run's read-only token could not.
//! Generated into `ci-gate-fork.yml`.
//!
//! `workflow_run` runs this file from `main` with a write token, and never
//! checks out the fork's code. It acts only while the PR still carries the
//! label, which only people who can label PRs can add.

use gh_workflow::{
    Event, Expression, Job, Level, Permissions, Workflow, WorkflowRun, WorkflowRunType,
};

use crate::workflows::pr_ci;

/// Build the workflow.
pub fn ci_gate_fork() -> Workflow {
    Workflow::new("CI Gate for Forks")
        .on(Event::default().workflow_run(
            WorkflowRun::default()
                .add_type(WorkflowRunType::Completed)
                .add_workflow("PR CI"),
        ))
        .add_job("report", report())
}

fn report() -> Job {
    Job::default()
        .name("Report a fork's CI result")
        .cond(Expression::new(
            "github.event.workflow_run.event == 'pull_request' && github.event.workflow_run.head_repository.full_name != github.repository",
        ))
        .runs_on("ubuntu-latest")
        .timeout_minutes(5u32)
        .permissions(Permissions {
            actions: Some(Level::Read),
            issues: Some(Level::Write),
            pull_requests: Some(Level::Write),
            statuses: Some(Level::Write),
            ..Default::default()
        })
        .add_step(pr_ci::gate_step("Set the CI gate status", "fork"))
}
