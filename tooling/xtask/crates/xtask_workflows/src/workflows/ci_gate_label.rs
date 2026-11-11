//! `CI Gate Label Check` — when the `run-ci` label goes on a PR, checks that it
//! can start [`pr_ci`](crate::workflows::pr_ci), and says why not in `CI gate`.
//! Generated into `ci-gate-label.yml`.
//!
//! `PR CI` runs only on PRs into `main`, so the label on a PR into any other
//! branch starts nothing; this check runs on every base to say so. `pull_request`
//! runs take their workflow files from the PR's merge commit with `main`.
//! GitHub refreshes that commit on a push, not when `main` moves, and makes none
//! while the PR conflicts. So the label on a PR last pushed before `PR CI`
//! existed, or on a conflicting one, starts nothing. This workflow uses
//! `pull_request_target`, which runs `main`'s copy whatever the merge commit
//! holds, and checks out nothing.

use gh_workflow::{
    Event, Expression, Job, Level, Permissions, PullRequestTarget, PullRequestType, Workflow,
};

use crate::workflows::pr_ci;

/// Build the workflow.
pub fn ci_gate_label() -> Workflow {
    Workflow::new("CI Gate Label Check")
        .on(Event::default()
            .pull_request_target(PullRequestTarget::default().add_type(PullRequestType::Labeled)))
        .add_job("check", check())
}

/// Fork PRs get the same check in `CI Gate for Forks`, before it opens their
/// request.
fn check() -> Job {
    Job::default()
        .name("Check the label can start PR CI")
        .cond(Expression::new(format!(
            "github.event.label.name == '{}' && github.event.pull_request.head.repo.full_name == github.repository",
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
            pr_ci::gate_step("Check the merge commit holds PR CI", "label")
                .add_env(("PR_NUMBER", "${{ github.event.pull_request.number }}"))
                .add_env(("HEAD_SHA", "${{ github.event.pull_request.head.sha }}"))
                .add_env(("CI_GATE_DOCS_URL", pr_ci::GATE_DOCS_URL)),
        )
}
