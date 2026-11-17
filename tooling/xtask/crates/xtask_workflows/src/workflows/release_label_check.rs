//! `Release Label Check` — tells the author when an `ios-update` /
//! `android-update` label could not start a release. The release workflows
//! run on `pull_request` events, and GitHub creates no run at all for a
//! `pull_request` event on a PR that conflicts with its base (there is no
//! merge ref to run against); the release job also skips fork PRs. In both
//! cases the label silently does nothing, and nothing is left on the PR to
//! say so. `pull_request_target` events are delivered regardless, so this
//! workflow explains on the PR and removes the label: a release label with
//! no release behind it would make the drift and watch workflows treat the
//! next push as a drifted release. On a mergeable PR it instead announces the
//! release that did start, with the version in flight and a link to the run.
//!
//! `pull_request_target` runs with base-repo permissions on fork PRs, so
//! this job must never check out or execute PR head code — there is
//! deliberately no checkout step; it only reads event metadata and calls the
//! PR API.

use gh_workflow::expr::typed::{Bool, Expr, Str, github};
use gh_workflow::{
    Event, Job, Level, Permissions, PullRequestTarget, PullRequestType, Step, Workflow,
};

use crate::workflows::runners;

/// Build the workflow.
pub fn release_label_check() -> Workflow {
    Workflow::new("Release Label Check")
        .on(Event::default()
            .pull_request_target(PullRequestTarget::default().add_type(PullRequestType::Labeled)))
        .add_job("check", check_job())
}

fn label() -> Expr<Str> {
    github().event("label.name")
}

fn ios() -> Expr<Bool> {
    label().eq("ios-update")
}

fn check_job() -> Job {
    Job::default()
        .name("Announce the release the label started")
        .cond(ios().or(label().eq("android-update")))
        .runs_on(runners::Runner::TinyNoCache.to_string())
        .timeout_minutes(10u32)
        // Write: the job comments on the PR and removes the label.
        .permissions(Permissions::default().pull_requests(Level::Write))
        .add_env(("GH_TOKEN", github().token()))
        .add_env(("GH_REPO", github().repository()))
        .add_env(("PR_NUMBER", github().event::<Str>("pull_request.number")))
        .add_env((
            "HEAD_REPO",
            github().event::<Str>("pull_request.head.repo.full_name"),
        ))
        .add_env(("HEAD_REF", github().event::<Str>("pull_request.head.ref")))
        .add_env(("HEAD_SHA", github().event::<Str>("pull_request.head.sha")))
        .add_env(("LABEL", label()))
        .add_env(("PLATFORM", ios().then_else("iOS", "Android")))
        .add_env((
            "WORKFLOW",
            ios().then_else("iOS App Store Release", "Android Play Release"),
        ))
        .add_env((
            "WORKFLOW_FILE",
            ios().then_else("ios-app-store-release.yml", "android-play-release.yml"),
        ))
        .add_env((
            "CONF_PATH",
            ios().then_else(
                "apps/web/tauri/src-tauri/tauri.ios.conf.json",
                "apps/web/tauri/src-tauri/tauri.android.conf.json",
            ),
        ))
        .add_step(
            Step::new("Announce the release, or explain why none started")
                .run(concat!(
                    include_str!("scripts/pr_merge_commit.sh"),
                    include_str!("scripts/release_label_check.sh"),
                ))
                .shell("bash"),
        )
}
