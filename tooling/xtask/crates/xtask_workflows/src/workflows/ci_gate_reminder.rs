//! `CI Gate Reminder` — on every new PR commit, sets the `CI gate` status to
//! pending with the command that runs CI, so the commit reads as not passed
//! until someone runs [`pr_ci`](crate::workflows::pr_ci). Generated into
//! `ci-gate-reminder.yml`.

use gh_workflow::{
    Event, Expression, Job, Level, Permissions, PullRequest, PullRequestType, Workflow,
};

use crate::workflows::pr_ci;

/// Build the workflow.
pub fn ci_gate_reminder() -> Workflow {
    Workflow::new("CI Gate Reminder")
        .on(Event::default().pull_request(
            PullRequest::default()
                .add_type(PullRequestType::Opened)
                .add_type(PullRequestType::Synchronize)
                .add_type(PullRequestType::Reopened),
        ))
        .add_job("remind", remind())
}

/// GitHub's hosted runner: a status call needs no Namespace machine. A fork's
/// read-only token can't set statuses, so its commits show the required status
/// as expected instead.
fn remind() -> Job {
    Job::default()
        .name("CI not run yet")
        .cond(Expression::new(
            "github.event.pull_request.head.repo.full_name == github.repository",
        ))
        .runs_on("ubuntu-latest")
        .timeout_minutes(5u32)
        .permissions(Permissions {
            statuses: Some(Level::Write),
            ..Default::default()
        })
        .add_step(
            pr_ci::gate_step("Mark the commit as not run", "remind")
                .add_env(("PR_NUMBER", "${{ github.event.pull_request.number }}"))
                .add_env(("HEAD_SHA", "${{ github.event.pull_request.head.sha }}"))
                .add_env(("CI_GATE_DOCS_URL", pr_ci::GATE_DOCS_URL)),
        )
}
