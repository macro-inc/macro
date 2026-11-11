//! `CI Gate for Forks` — what `PR CI`'s start and gate steps can't do for a
//! fork PR, whose token is read-only. Generated into `ci-gate-fork.yml`.
//!
//! Both triggers run this file from `main` with a write token and never check
//! out the fork's code. When the label goes on, `request` removes it and opens
//! a pending `CI gate` request on the head it was added at. When the fork's run
//! ends, `report` copies its verdict, but only onto a commit with an open
//! request: a fork token can't set statuses, so a run on any other commit
//! reports nothing. A request whose run ended without a verdict fails, as
//! `CI Gate Run End` does for same-repo runs.
//!
//! The fork's run uses the fork's workflow files, so both jobs fail closed when
//! the fork changed `.github` or the workflow generator, and `report` trusts
//! only a run of `pr-ci.yml`.

use gh_workflow::{
    Event, Expression, Job, Level, Permissions, PullRequestTarget, PullRequestType, Workflow,
    WorkflowRun, WorkflowRunType,
};

use crate::workflows::pr_ci;

const FORK_PULL_REQUEST: &str =
    "github.event.pull_request.head.repo.full_name != github.repository";

/// Build the workflow.
pub fn ci_gate_fork() -> Workflow {
    Workflow::new("CI Gate for Forks")
        .on(Event::default()
            // Every base, so a request on a PR into another branch fails with why.
            .pull_request_target(PullRequestTarget::default().add_type(PullRequestType::Labeled))
            .workflow_run(
                WorkflowRun::default()
                    .add_type(WorkflowRunType::Completed)
                    .add_workflow("PR CI"),
            ))
        .add_job("request", request())
        .add_job("report", report())
}

fn request() -> Job {
    Job::default()
        .name("Take a fork's CI request")
        .cond(Expression::new(format!(
            "github.event_name == 'pull_request_target' && github.event.label.name == '{}' && {FORK_PULL_REQUEST}",
            pr_ci::RUN_LABEL
        )))
        .runs_on("ubuntu-latest")
        .timeout_minutes(5u32)
        .permissions(Permissions {
            contents: Some(Level::Read),
            issues: Some(Level::Write),
            pull_requests: Some(Level::Write),
            statuses: Some(Level::Write),
            ..Default::default()
        })
        .add_step(
            pr_ci::gate_step("Open the CI gate request", "fork-request")
                .add_env(("PR_NUMBER", "${{ github.event.pull_request.number }}"))
                .add_env(("HEAD_SHA", "${{ github.event.pull_request.head.sha }}"))
                .add_env(("BASE_REF", "${{ github.event.pull_request.base.ref }}"))
                .add_env(("CI_GATE_DOCS_URL", pr_ci::GATE_DOCS_URL))
                .add_env((
                    "PR_CHECKS_URL",
                    "${{ github.event.pull_request.html_url }}/checks",
                )),
        )
}

fn report() -> Job {
    Job::default()
        .name("Report a fork's CI result")
        .cond(Expression::new(
            "github.event_name == 'workflow_run' && github.event.workflow_run.event == 'pull_request' && github.event.workflow_run.head_repository.full_name != github.repository",
        ))
        .runs_on("ubuntu-latest")
        .timeout_minutes(5u32)
        .permissions(Permissions {
            actions: Some(Level::Read),
            contents: Some(Level::Read),
            statuses: Some(Level::Write),
            ..Default::default()
        })
        // `PR CI` runs only for pull requests into `main`.
        .add_step(pr_ci::gate_step("Set the CI gate status", "fork").add_env(("BASE_REF", "main")))
}
