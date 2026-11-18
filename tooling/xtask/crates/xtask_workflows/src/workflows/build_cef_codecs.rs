//! `Build CEF with codecs` — builds the CEF minimal distribution pinned in
//! `apps/web/tauri/desktop-cef/cef-codecs.json` with proprietary codecs
//! (H.264, HEVC, AAC) and publishes it as a prerelease asset. The CEF CDN
//! builds omit those codecs, so the macOS app could not play most videos; the
//! DMG build fetches this asset instead. Generated into `build_cef_codecs.yml`.
//!
//! It runs when the manifest changes on a PR, so a CEF upgrade builds its
//! distribution before the pin lands, and is skipped when the release asset
//! already exists.

use gh_workflow::{
    Concurrency, Event, Expression, Job, Level, Permissions, PullRequest, Step, Workflow,
    WorkflowDispatch,
};

use crate::workflows::{runners, steps};

#[cfg(test)]
mod test;

/// Build the workflow.
pub fn build_cef_codecs() -> Workflow {
    Workflow::new("Build CEF with codecs")
        .permissions(Permissions {
            contents: Some(Level::Write),
            ..Default::default()
        })
        .on(Event::default()
            .pull_request(
                PullRequest::default()
                    .add_branch("main")
                    .add_path(xtask_paths::repo_glob!(
                        "apps/web/tauri/desktop-cef/cef-codecs.json"
                    ))
                    .add_path(xtask_paths::repo_glob!(
                        "tooling/xtask/crates/xtask_workflows/src/workflows/scripts/build_cef_codecs.sh"
                    ))
                    .add_path(xtask_paths::repo_glob!(".github/workflows/build_cef_codecs.yml")),
            )
            .workflow_dispatch(WorkflowDispatch::default()))
        // One Chromium build per manifest at a time; never cancel a build hours in.
        .concurrency(
            Concurrency::new(Expression::new("build-cef-codecs")).cancel_in_progress(false),
        )
        .add_job("build-cef", build_cef_job())
}

fn build_cef_job() -> Job {
    Job::default()
        .name("Build CEF with proprietary codecs (macOS arm64)")
        .runs_on(runners::Runner::MacOsArmLarge.to_string())
        // A full Chromium checkout and official build takes several hours.
        .timeout_minutes(1440u32)
        .cond(Expression::new(
            "github.event_name != 'pull_request' || \
             github.event.pull_request.head.repo.full_name == github.repository",
        ))
        .add_step(steps::checkout(false, false))
        .add_step(
            Step::new("Build and publish CEF")
                .run(include_str!("scripts/build_cef_codecs.sh"))
                .shell("bash")
                .add_env(("GH_TOKEN", "${{ github.token }}"))
                .add_env((
                    "TARGET_SHA",
                    "${{ github.event.pull_request.head.sha || github.sha }}",
                )),
        )
}
