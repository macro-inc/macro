//! `PR Privacy Check` — fails a PR whose title, body, or commit messages carry
//! personal or support-channel details (emails, phone numbers, @mentions,
//! chat-channel names, support-tool or Macro workspace links). The rule is the
//! Privacy section of `.agents/skills/git/SKILL.md`; `just pr-privacy` runs the
//! same script locally.
//!
//! It runs on `edited` too, so fixing the description re-runs the check. Title
//! and body reach the script through env vars, never interpolated into shell
//! code. There is no checkout: commits come from the PR API. Dependabot PRs are
//! skipped: their bodies quote upstream release notes, not our writing.

use gh_workflow::{
    Event, Expression, Job, Level, Permissions, PullRequest, PullRequestType, Step, Workflow,
};

use crate::workflows::runners;

/// Build the workflow.
pub fn pr_privacy_check() -> Workflow {
    Workflow::new("PR Privacy Check")
        .on(Event::default().pull_request(
            PullRequest::default()
                .add_type(PullRequestType::Opened)
                .add_type(PullRequestType::Edited)
                .add_type(PullRequestType::Reopened)
                .add_type(PullRequestType::Synchronize),
        ))
        .add_job("check", check_job())
}

fn check_job() -> Job {
    Job::default()
        .name("PR text has no personal or support-channel details")
        .cond(Expression::new(
            "github.event.pull_request.user.login != 'dependabot[bot]'",
        ))
        .runs_on(runners::Runner::TinyNoCache.to_string())
        .timeout_minutes(5u32)
        .permissions(
            Permissions::default()
                .contents(Level::Read)
                .pull_requests(Level::Read),
        )
        .add_env(("GH_TOKEN", "${{ github.token }}"))
        .add_env(("GH_REPO", "${{ github.repository }}"))
        .add_env(("PR_NUMBER", "${{ github.event.pull_request.number }}"))
        .add_env(("PR_TITLE", "${{ github.event.pull_request.title }}"))
        .add_env(("PR_BODY", "${{ github.event.pull_request.body }}"))
        .add_step(
            Step::new("Scan PR title, body, and commit messages")
                .run(include_str!("scripts/pr_privacy_check.sh"))
                .shell("bash"),
        )
}
