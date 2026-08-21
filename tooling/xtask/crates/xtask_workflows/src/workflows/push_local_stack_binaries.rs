//! Publish `.#local-stack-binaries` to the private S3 Nix cache.
//!
//! Sibling of the deploy pipeline on purpose: a cache miss or a failed `nix
//! copy` must not hold or fail `deploy_on_push` / `release-production`. The
//! ten deploy packages this aggregate reuses are already pushed by
//! `build-service-binaries`; this workflow exists for the five local-only
//! closures and the `buildEnv` wrapper. Generated into
//! `push_local_stack_binaries.yml`.

use gh_workflow::{
    Concurrency, Event, Expression, Job, Level, Permissions, Push, Workflow, WorkflowDispatch,
};

use crate::workflows::{runners, steps};

/// Build the workflow.
pub fn push_local_stack_binaries() -> Workflow {
    let mut push = Push::default().add_branch("main");
    for path in [
        xtask_paths::repo_glob!("Cargo.toml"),
        xtask_paths::repo_glob!("Cargo.lock"),
        xtask_paths::repo_glob!("rust-toolchain.toml"),
        xtask_paths::repo_glob!("crates/**"),
        xtask_paths::repo_glob!("services/**"),
        xtask_paths::repo_glob!("nix/**"),
        xtask_paths::repo_glob!("flake.nix"),
        xtask_paths::repo_glob!("flake.lock"),
        xtask_paths::repo_glob!(".github/actions/setup-nix/**"),
        xtask_paths::repo_glob!(".github/actions/teardown-nix/**"),
        xtask_paths::repo_glob!(".github/workflows/push_local_stack_binaries.yml"),
    ] {
        push = push.add_path(path);
    }

    Workflow::new("Push local stack binaries")
        .permissions(Permissions {
            contents: Some(Level::Read),
            ..Default::default()
        })
        .on(Event::default()
            .push(push)
            .workflow_dispatch(WorkflowDispatch::default()))
        .concurrency(
            Concurrency::new(Expression::new("${{ github.workflow }}-${{ github.ref }}"))
                .cancel_in_progress(true),
        )
        .add_job("push", push_job())
}

fn push_job() -> Job {
    Job::default()
        .name("Build and push local-stack-binaries")
        .runs_on(runners::Runner::Mid.to_string())
        .add_step(steps::checkout_v4())
        .add_step(steps::mount_nix_cache_volume())
        .add_step(steps::setup_nix_with_cache())
        .add_step(steps::nix_build(
            "Build local stack binaries",
            "\".#local-stack-binaries\"",
            "Local stack binaries realised into /nix/store.",
        ))
        .add_step(steps::push_nix_cache(".#local-stack-binaries"))
        .add_step(steps::teardown_nix())
}
