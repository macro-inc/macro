//! `Ensure Daytona Snapshot` — creates the managed agent harness snapshot when
//! it is missing, and publishes the same image to GHCR. Generated into
//! `ensure_daytona_snapshot.yml`.
//!
//! Local stacks `docker build` this image themselves (BuildKit
//! cache is the freshness check). GHCR is the published copy for `main`
//! (`:latest`) and for verifying the image on PRs (`:$SHA` only).

use gh_workflow::{
    Concurrency, Event, Expression, Job, Level, Permissions, PullRequest, PullRequestType, Push,
    Step, Workflow, WorkflowDispatch,
};

use crate::workflows::{runners, steps, vars};

#[cfg(test)]
mod test;

fn image_source_push() -> Push {
    let mut push = Push::default().add_branch("main");
    for path in image_source_paths() {
        push = push.add_path(path);
    }
    push
}

fn image_source_pull_request() -> PullRequest {
    let mut pr = PullRequest::default()
        .add_branch("main")
        .add_type(PullRequestType::Opened)
        .add_type(PullRequestType::Synchronize)
        .add_type(PullRequestType::Reopened);
    for path in image_source_paths() {
        pr = pr.add_path(path);
    }
    pr
}

fn image_source_paths() -> [xtask_paths::RepoGlob<'static>; 5] {
    [
        xtask_paths::repo_glob!("crates/agent_harness/container/**"),
        xtask_paths::repo_glob!("crates/agent_harness/justfile"),
        xtask_paths::repo_glob!("nix/cloud-storage.nix"),
        xtask_paths::repo_glob!(
            "tooling/xtask/crates/xtask_workflows/src/workflows/ensure_daytona_snapshot.rs"
        ),
        xtask_paths::repo_glob!(".github/workflows/ensure_daytona_snapshot.yml"),
    ]
}

/// Build the workflow.
pub fn ensure_daytona_snapshot() -> Workflow {
    Workflow::new("Ensure Daytona Snapshot")
        .permissions(
            Permissions::default()
                .contents(Level::Read)
                .packages(Level::Write),
        )
        .on(Event::default()
            .push(image_source_push())
            .pull_request(image_source_pull_request())
            .workflow_dispatch(WorkflowDispatch::default()))
        .concurrency(
            Concurrency::new(Expression::new("${{ github.workflow }}-${{ github.ref }}"))
                .cancel_in_progress(false),
        )
        .add_job("ensure-snapshot", ensure_snapshot())
        .add_job("publish-image", publish_image())
}

fn ensure_snapshot() -> Job {
    Job::default()
        .name("Ensure macro-agent-harness snapshot")
        .runs_on(runners::Runner::Small.to_string())
        // PRs only need the GHCR publish; Daytona snapshot create is main-only.
        .cond(Expression::new("github.event_name != 'pull_request'"))
        .add_step(steps::checkout(false, false))
        .add_step(steps::mount_nix_cache_volume())
        .add_step(steps::setup_nix())
        .add_step(steps::setup_dev_shell())
        .add_step(
            Step::new("Ensure Daytona snapshot")
                .run(indoc::indoc! {r#"
                    set -euo pipefail
                    if [[ -z "${DAYTONA_API_KEY:-}" ]]; then
                      echo "::error::DAYTONA_API_KEY repository secret is not configured"
                      exit 1
                    fi
                    daytona login --api-key "$DAYTONA_API_KEY"
                    just --justfile crates/agent_harness/justfile ensure-daytona
                "#})
                .shell("bash")
                .add_env(("DAYTONA_API_KEY", vars::DAYTONA_API_KEY)),
        )
}

/// GHCR publish. Runs on Mid with Namespace remote buildx: the Dockerfile
/// bakes two nix shells, which is too large for the Small Daytona job's local
/// daemon. linux/amd64 only — Daytona snapshots are
/// amd64. Local `docker build` is unpinned so Apple Silicon / ARM Linux bake
/// native `aarch64-linux` from the same flake. PRs push `:$SHA` only so they
/// cannot clobber `:latest`.
fn publish_image() -> Job {
    let image = vars::AGENT_HARNESS_GHCR_IMAGE;
    Job::default()
        .name("Publish sandbox image to GHCR")
        .runs_on(runners::Runner::Mid.to_string())
        .timeout_minutes(90u32)
        .cond(Expression::new(
            "github.event_name != 'pull_request' || \
             github.event.pull_request.head.repo.full_name == github.repository",
        ))
        .add_step(steps::checkout(false, false))
        .add_step(steps::setup_namespace_buildx())
        .add_step(
            Step::new("Log in to GHCR")
                .run(indoc::indoc! {r#"
                    set -euo pipefail
                    echo "$GITHUB_TOKEN" | docker login ghcr.io -u "$GITHUB_ACTOR" --password-stdin
                "#})
                .shell("bash")
                .add_env(("GITHUB_TOKEN", "${{ secrets.GITHUB_TOKEN }}"))
                .add_env(("GITHUB_ACTOR", "${{ github.actor }}")),
        )
        .add_step(
            Step::new("Build and push sandbox image")
                .run(format!(
                    r#"set -euo pipefail
image={image}
tags=(--tag "$image:$GITHUB_SHA")
if [ "${{GITHUB_REF:-}}" = "refs/heads/main" ]; then
  tags+=(--tag "$image:latest")
fi
docker buildx build \
  --platform linux/amd64 \
  "${{tags[@]}}" \
  --push \
  crates/agent_harness/container
"#
                ))
                .shell("bash"),
        )
}
