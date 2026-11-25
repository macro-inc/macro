//! `Build CEF with codecs` — builds the CEF minimal distributions pinned in
//! `apps/web/tauri/desktop-cef/cef-codecs.json` with proprietary codecs
//! (H.264, HEVC, AAC) and publishes them as prerelease assets, one per Mac
//! architecture. The CEF CDN builds omit those codecs, so the macOS app could
//! not play most videos; the DMG builds fetch these assets instead. Generated
//! into `build_cef_codecs.yml`.
//!
//! It runs when the manifest changes on a PR, so a CEF upgrade builds its
//! distributions before the pin lands. Each architecture's job is skipped when
//! the manifest lists no asset for it or its release asset already exists.

use gh_workflow::expr::typed::{Str, github};
use gh_workflow::{
    Concurrency, Event, Job, Level, Permissions, PullRequest, Step, Workflow, WorkflowDispatch,
};

use crate::workflows::{runners, steps};

#[cfg(test)]
mod test;

/// Build the workflow.
pub fn build_cef_codecs() -> Workflow {
    Workflow::new("Build CEF with codecs")
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
            Concurrency::new("build-cef-codecs").cancel_in_progress(false),
        )
        .add_job("build-cef", build_cef_job("aarch64", "arm64"))
        .add_job("build-cef-x86_64", build_cef_job("x86_64", "x86_64"))
}

/// Build the distribution for `arch` (the manifest's key) on Apple silicon,
/// which cross-compiles the Intel one.
fn build_cef_job(arch: &str, label: &str) -> Job {
    Job::default()
        .name(format!("Build CEF with proprietary codecs (macOS {label})"))
        // Each job publishes its own asset to the release.
        .permissions(Permissions {
            contents: Some(Level::Write),
            ..Default::default()
        })
        .runs_on(runners::Runner::MacOsArmLarge.to_string())
        // A full Chromium checkout and official build takes several hours.
        .timeout_minutes(1440u32)
        .cond(
            github().event_name().ne("pull_request").or(github()
                .event::<Str>("pull_request.head.repo.full_name")
                .eq(github().repository())),
        )
        .add_step(steps::checkout(false, false))
        .add_step(
            Step::new("Build and publish CEF")
                .run(include_str!("scripts/build_cef_codecs.sh"))
                .shell("bash")
                .add_env(("GH_TOKEN", github().token()))
                .add_env(("CEF_ARCH", arch))
                .add_env((
                    "TARGET_SHA",
                    github()
                        .event::<Str>("pull_request.head.sha")
                        .or_else(github().sha()),
                )),
        )
}
