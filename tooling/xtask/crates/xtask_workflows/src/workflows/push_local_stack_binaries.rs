//! Publish `.#local-stack-binaries` to the private S3 Nix cache.
//!
//! Sibling of the deploy pipeline on purpose: a cache miss or a failed `nix
//! copy` must not hold or fail `deploy_on_push` / `release-production`. The
//! ten deploy packages this aggregate reuses are already pushed by
//! `build-service-binaries`; this workflow exists for the five local-only
//! closures and the `buildEnv` wrapper. Cursor Cloud's `.cursor` scripts
//! substitute them from the cache instead of compiling. Generated into
//! `push_local_stack_binaries.yml`.
//!
//! Runs hourly from main, not on every push. A build that changes Rust takes
//! about 30 minutes and main takes several pushes in that time, so a run per
//! push cancelled the one before it and most main commits showed a cancelled
//! check. Hourly keeps the cache within about an hour of main.

use gh_workflow::{
    Concurrency, Event, Expression, Job, Level, Permissions, Schedule, Workflow, WorkflowDispatch,
};

use crate::workflows::{runners, steps};

/// Off the hour, when GitHub delays fewer scheduled runs.
const HOURLY: &str = "17 * * * *";

/// Ends a stuck build so the runs queued behind it drain, instead of GitHub
/// cancelling each waiting tick as the next one arrives. The longest
/// successful build took 69 minutes.
const TIMEOUT_MINUTES: u32 = 110;

/// Build the workflow.
pub fn push_local_stack_binaries() -> Workflow {
    Workflow::new("Push local stack binaries")
        .permissions(Permissions {
            contents: Some(Level::Read),
            ..Default::default()
        })
        .on(Event::default()
            .add_schedule(Schedule::new(HOURLY))
            .workflow_dispatch(WorkflowDispatch::default()))
        // Never cancel a build in progress: a later tick or a manual dispatch
        // waits for it and then builds only what changed.
        .concurrency(
            Concurrency::new(Expression::new("${{ github.workflow }}-${{ github.ref }}"))
                .cancel_in_progress(false),
        )
        .add_job("push", push_job())
}

fn push_job() -> Job {
    Job::default()
        .name("Build and push local-stack-binaries")
        .runs_on(runners::Runner::Mid.to_string())
        .timeout_minutes(TIMEOUT_MINUTES)
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
