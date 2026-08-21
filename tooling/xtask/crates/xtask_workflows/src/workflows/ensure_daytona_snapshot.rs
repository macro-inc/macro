//! `Ensure Daytona Snapshot` — creates the managed agent harness snapshot when
//! it is missing, and publishes the same image to GHCR for local stacks and
//! Fly previews. Generated into `ensure_daytona_snapshot.yml`.

use gh_workflow::{
    Concurrency, Event, Expression, Job, Level, Permissions, Push, Step, Workflow, WorkflowDispatch,
};

use crate::workflows::{runners, steps, vars};

#[cfg(test)]
mod test;

/// Build the workflow.
pub fn ensure_daytona_snapshot() -> Workflow {
    Workflow::new("Ensure Daytona Snapshot")
        .permissions(
            Permissions::default()
                .contents(Level::Read)
                .packages(Level::Write),
        )
        .on(Event::default()
            .push(
                Push::default()
                    .add_branch("main")
                    .add_path(xtask_paths::repo_glob!(
                        "crates/agent_harness/container/**"
                    ))
                    .add_path(xtask_paths::repo_glob!(
                        "crates/agent_harness/justfile"
                    ))
                    .add_path(xtask_paths::repo_glob!("nix/cloud-storage.nix"))
                    .add_path(xtask_paths::repo_glob!(
                        "tooling/xtask/crates/xtask_workflows/src/workflows/ensure_daytona_snapshot.rs"
                    ))
                    .add_path(xtask_paths::repo_glob!(
                        ".github/workflows/ensure_daytona_snapshot.yml"
                    )),
            )
            .workflow_dispatch(WorkflowDispatch::default()))
        .concurrency(
            Concurrency::new(Expression::new("${{ github.workflow }}")).cancel_in_progress(false),
        )
        .add_job("ensure-snapshot", ensure_snapshot())
        .add_job("publish-image", publish_image())
}

fn ensure_snapshot() -> Job {
    Job::default()
        .name("Ensure macro-agent-harness snapshot")
        .runs_on(runners::Runner::Small.to_string())
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

/// Multi-arch GHCR publish. Runs on Mid with Namespace remote buildx: the
/// Dockerfile bakes two nix shells, which is too large for the Small Daytona
/// job's local daemon.
fn publish_image() -> Job {
    let image = vars::AGENT_HARNESS_GHCR_IMAGE;
    Job::default()
        .name("Publish sandbox image to GHCR")
        .runs_on(runners::Runner::Mid.to_string())
        .timeout_minutes(90u32)
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
docker buildx build \
  --platform linux/amd64,linux/arm64 \
  --tag "$image:$GITHUB_SHA" \
  --tag "$image:latest" \
  --push \
  crates/agent_harness/container
"#
                ))
                .shell("bash"),
        )
}
