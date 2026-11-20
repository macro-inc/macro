//! `iOS Preview` — opt-in Appetize iPhone-simulator preview for a PR.
//! Generated into `ios_preview.yml`.
//!
//! Add the `ios-preview` label to a PR and this builds an arm64 iOS
//! **Simulator** `.app` (Appetize cannot stream a device `.ipa`), publishes it
//! to an Appetize app owned by that PR, and posts a comment with one link per
//! device size. Appetize's `autoplay=false` means the simulator boots — and
//! bills — only when a reviewer clicks, so an unopened preview is free.
//!
//! `workflow_dispatch` builds without touching Appetize and leaves the `.app`
//! as an artifact; the iOS build has never run in CI, so that is the cheap way
//! to iterate on it without a PR or an API token.
//!
//! NOTE: like the web preview steps, this must NOT be a required status check — a
//! PR should stay mergeable regardless of whether its preview built.

use gh_workflow::expr::typed::{Bool, Expr, Json, Str, always, github};
use gh_workflow::{
    Concurrency, Env, Event, Job, Level, Permissions, PullRequest, PullRequestType, Run, Step, Use,
    Workflow, WorkflowDispatch,
};

use crate::workflows::{runners, steps, vars};

const LABEL: &str = "ios-preview";

/// Where `build_ios_simulator_app.sh` leaves the zipped bundle. The CI artifact
/// and the bytes handed to Appetize are the same archive, so a preview that
/// misbehaves can be reproduced in a local simulator from the artifact.
const ARCHIVE_PATH: &str = "artifacts/macro-sim.zip";

/// Build the workflow.
pub fn ios_preview() -> Workflow {
    Workflow::new("iOS Preview")
        .on(Event::default()
            .pull_request(pull_request_event())
            .workflow_dispatch(WorkflowDispatch::default()))
        .concurrency(
            // `github.ref` keeps manual dispatches from all sharing one group.
            Concurrency::new(format!(
                "ios-preview-{}",
                pr_number().or_else(github().git_ref())
            ))
            .cancel_in_progress(true),
        )
        .add_job("preview", preview())
        .add_job("cleanup", cleanup())
}

fn pull_request_event() -> PullRequest {
    PullRequest::default()
        .add_type(PullRequestType::Labeled)
        .add_type(PullRequestType::Synchronize)
        .add_type(PullRequestType::Reopened)
        .add_type(PullRequestType::Closed)
}

/// `labeled` fires for *every* label and `synchronize` fires regardless of
/// labels, so both need the same membership test: is `ios-preview` on the PR
/// right now? Reading it off the event payload avoids an API call, and means
/// removing the label stops later pushes from building.
fn labelled_and_open() -> Expr<Bool> {
    let labelled = github()
        .event::<Json>("pull_request.labels.*.name")
        .contains(LABEL);
    github().event_name().eq("workflow_dispatch").or(github()
        .event::<Str>("action")
        .ne("closed")
        .and(labelled)
        .and(github().event::<Bool>("pull_request.draft").eq(false)))
}

fn pr_number() -> Expr<Str> {
    github().event("pull_request.number")
}

fn preview() -> Job {
    Job::default()
        .name("Build iOS simulator app and publish to Appetize")
        .runs_on(runners::Runner::MacOsTahoeArm.to_string())
        .cond(labelled_and_open())
        // A cold run — fresh nix store, no cached aarch64-apple-ios-sim
        // artifacts — measured 11m15s on Sequoia, but 40 minutes on the Tahoe
        // image, 31 of them fetching the dev shell from cache.nixos.org. This
        // leaves room for that without letting a hung xcodebuild sit for long.
        .timeout_minutes(60u32)
        .permissions(
            Permissions::default()
                .contents(Level::Read)
                .pull_requests(Level::Write),
        )
        .add_step(steps::checkout(false, false))
        .add_step(steps::select_ios_xcode())
        .add_step(steps::install_nix_macos())
        .add_step(build_simulator_app())
        .add_step(upload_app_artifact().if_condition(always()))
        .add_step(publish_preview())
}

fn build_simulator_app() -> Step<Run> {
    Step::new("Build iOS simulator app")
        .run(include_str!("scripts/build_ios_simulator_app.sh"))
        .shell("bash")
        .id("build")
}

/// Kept for every run, including `workflow_dispatch`: when a preview misbehaves
/// the first question is whether the bundle or the streaming is at fault, and
/// this lets you drop the same archive into a local simulator. The launch
/// screenshot and log archive come along on failures too — `if: always()` —
/// since a build that dies at the smoke test is exactly when they are wanted.
fn upload_app_artifact() -> Step<Use> {
    steps::upload_artifact_action(
        "macro-ios-simulator-app",
        xtask_paths::runtime_path!("artifacts/*"),
    )
    .if_no_files_found("warn")
    .step()
}

/// Uploads the archive and posts the comment. The PR number, branch and SHA
/// are attacker-controlled, so they reach the script through the environment —
/// an env expansion can never become script text. Same convention as
/// `cleanup_preview::get_preview_id`.
fn publish_preview() -> Step<Run> {
    publish_step("Publish to Appetize and comment")
        .if_condition(github().event_name().eq("pull_request"))
        .add_env(Env::new("ARCHIVE_PATH", ARCHIVE_PATH))
        .add_env(Env::new("BRANCH", github().head_ref()))
        .add_env(Env::new(
            "SHA",
            github().event::<Str>("pull_request.head.sha"),
        ))
}

/// The publish and cleanup steps run the same script; `CLEANUP` picks the mode.
fn publish_step(name: &str) -> Step<Run> {
    Step::new(name)
        .run(include_str!("scripts/publish_ios_preview.sh"))
        .shell("bash")
        .add_env(Env::new("APPETIZE_API_TOKEN", vars::APPETIZE_API_TOKEN))
        .add_env(Env::new("GH_TOKEN", vars::GITHUB_TOKEN))
        .add_env(Env::new("REPO", github().repository()))
        .add_env(Env::new("PR_NUMBER", pr_number()))
}

/// Appetize apps outlive their PR unless something deletes them, and the key
/// only exists in the preview comment — so this has to run while the PR (and
/// its comments) are still readable.
fn cleanup() -> Job {
    Job::default()
        .name("Delete the PR's Appetize app")
        .runs_on(runners::Runner::TinyNoCache.to_string())
        .cond(
            github()
                .event_name()
                .eq("pull_request")
                .and(github().event::<Str>("action").eq("closed")),
        )
        .permissions(
            Permissions::default()
                .contents(Level::Read)
                .pull_requests(Level::Read),
        )
        .add_step(steps::checkout(false, false))
        .add_step(publish_step("Delete Appetize app").add_env(Env::new("CLEANUP", "1")))
}
