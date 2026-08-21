//! `Ensure Daytona Snapshot` — creates the managed agent harness snapshot when
//! it is missing. Generated into `ensure_daytona_snapshot.yml`.

use gh_workflow::{
    Concurrency, Event, Expression, Job, Level, Permissions, Push, Step, Workflow, WorkflowDispatch,
};

use crate::workflows::{runners, steps, vars};

/// Build the workflow.
pub fn ensure_daytona_snapshot() -> Workflow {
    Workflow::new("Ensure Daytona Snapshot")
        .permissions(Permissions {
            contents: Some(Level::Read),
            ..Default::default()
        })
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
