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
//! NOTE: like `deploy_preview`, this must NOT be a required status check — a
//! PR should stay mergeable regardless of whether its preview built.

use gh_workflow::{
    Concurrency, Env, Event, Expression, Job, Level, Permissions, PullRequest, PullRequestType,
    Run, Step, Use, Workflow, WorkflowDispatch,
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
            Concurrency::new(Expression::new(
                "ios-preview-${{ github.event.pull_request.number || github.ref }}",
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
fn labelled_and_open() -> String {
    format!(
        "github.event_name == 'workflow_dispatch' || (github.event.action != 'closed' \
         && contains(github.event.pull_request.labels.*.name, '{LABEL}') \
         && github.event.pull_request.draft == false)"
    )
}

fn preview() -> Job {
    Job::default()
        .name("Build iOS simulator app and publish to Appetize")
        .runs_on(runners::Runner::MacOsArm.to_string())
        .cond(Expression::new(labelled_and_open()))
        // A cold run — fresh nix store, no cached aarch64-apple-ios-sim
        // artifacts — measured 11m15s. This leaves room for a slower runner
        // without letting a genuinely hung xcodebuild sit for an hour.
        .timeout_minutes(40u32)
        .permissions(
            Permissions::default()
                .contents(Level::Read)
                .pull_requests(Level::Write),
        )
        .add_step(steps::checkout(false, false))
        .add_step(steps::install_nix_macos())
        // The build reaches bun through `nix develop`, but the publish and
        // comment steps run outside the shell and need it on PATH themselves.
        .add_step(steps::setup_bun())
        .add_step(build_simulator_app())
        .add_step(upload_app_artifact())
        .add_step(upload_to_appetize())
        .add_step(comment_on_pr())
}

fn build_simulator_app() -> Step<Run> {
    Step::new("Build iOS simulator app")
        .run(include_str!("scripts/build_ios_simulator_app.sh"))
        .shell("bash")
        .id("build")
}

/// Kept for every run, including `workflow_dispatch`: when a preview misbehaves
/// the first question is whether the bundle or the streaming is at fault, and
/// this lets you drop the same archive into a local simulator.
fn upload_app_artifact() -> Step<Use> {
    steps::upload_artifact(
        "macro-ios-simulator-app",
        xtask_paths::runtime_path!("artifacts/macro-sim.zip"),
    )
}

/// The PR number, branch and SHA are attacker-controlled, so they reach the
/// script through the environment — an env expansion can never become script
/// text. Same convention as `cleanup_preview::get_preview_id`.
fn upload_to_appetize() -> Step<Run> {
    Step::new("Publish to Appetize")
        .run(indoc::indoc! {r#"
            PUBLIC_KEY=$(bun scripts/ios-preview/upload-appetize.ts \
              --archive "../../$ARCHIVE_PATH" \
              --pr "$PR_NUMBER" \
              --repo "$REPO" \
              --token "$GITHUB_TOKEN" \
              --note "PR #$PR_NUMBER $SHA $BRANCH")
            echo "public-key=$PUBLIC_KEY" >> $GITHUB_OUTPUT
        "#})
        .id("appetize")
        .shell("bash")
        .if_condition(Expression::new("github.event_name == 'pull_request'"))
        .working_directory(xtask_paths::repo_dir!("apps/web"))
        .add_env(Env::new("APPETIZE_API_TOKEN", vars::APPETIZE_API_TOKEN))
        .add_env(Env::new("ARCHIVE_PATH", ARCHIVE_PATH))
        .add_env(Env::new("GITHUB_TOKEN", "${{ secrets.GITHUB_TOKEN }}"))
        .add_env(Env::new("REPO", "${{ github.repository }}"))
        .add_env(Env::new(
            "PR_NUMBER",
            "${{ github.event.pull_request.number }}",
        ))
        .add_env(Env::new("BRANCH", "${{ github.head_ref }}"))
        .add_env(Env::new("SHA", "${{ github.event.pull_request.head.sha }}"))
}

fn comment_on_pr() -> Step<Run> {
    Step::new("Comment on PR")
        .run(indoc::indoc! {r#"
            bun scripts/ios-preview/post-ios-comment.ts \
              --pr "$PR_NUMBER" \
              --repo "$REPO" \
              --token "$GITHUB_TOKEN" \
              --public-key "$PUBLIC_KEY" \
              --branch "$BRANCH" \
              --sha "$SHA"
        "#})
        .shell("bash")
        .if_condition(Expression::new("github.event_name == 'pull_request'"))
        .working_directory(xtask_paths::repo_dir!("apps/web"))
        .add_env(Env::new("GITHUB_TOKEN", "${{ secrets.GITHUB_TOKEN }}"))
        .add_env(Env::new("REPO", "${{ github.repository }}"))
        .add_env(Env::new(
            "PR_NUMBER",
            "${{ github.event.pull_request.number }}",
        ))
        .add_env(Env::new(
            "PUBLIC_KEY",
            "${{ steps.appetize.outputs.public-key }}",
        ))
        .add_env(Env::new("BRANCH", "${{ github.head_ref }}"))
        .add_env(Env::new("SHA", "${{ github.event.pull_request.head.sha }}"))
}

/// Appetize apps outlive their PR unless something deletes them, and the key
/// only exists in the preview comment — so this has to run while the PR (and
/// its comments) are still readable.
fn cleanup() -> Job {
    Job::default()
        .name("Delete the PR's Appetize app")
        .runs_on(runners::Runner::TinyNoCache.to_string())
        .cond(Expression::new(
            "github.event_name == 'pull_request' && github.event.action == 'closed'",
        ))
        .permissions(
            Permissions::default()
                .contents(Level::Read)
                .pull_requests(Level::Read),
        )
        .add_step(steps::checkout(false, false))
        .add_step(steps::setup_bun())
        .add_step(
            Step::new("Delete Appetize app")
                .run(indoc::indoc! {r#"
                    bun scripts/ios-preview/upload-appetize.ts \
                      --pr "$PR_NUMBER" \
                      --repo "$REPO" \
                      --token "$GITHUB_TOKEN" \
                      --cleanup
                "#})
                .shell("bash")
                .working_directory(xtask_paths::repo_dir!("apps/web"))
                .add_env(Env::new("APPETIZE_API_TOKEN", vars::APPETIZE_API_TOKEN))
                .add_env(Env::new("GITHUB_TOKEN", "${{ secrets.GITHUB_TOKEN }}"))
                .add_env(Env::new("REPO", "${{ github.repository }}"))
                .add_env(Env::new(
                    "PR_NUMBER",
                    "${{ github.event.pull_request.number }}",
                )),
        )
}
