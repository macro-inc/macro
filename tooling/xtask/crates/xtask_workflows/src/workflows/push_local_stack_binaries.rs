//! Publish `.#local-stack-binaries` to the private S3 Nix cache.
//!
//! Sibling of the deploy pipeline on purpose: a cache miss or a failed `nix
//! copy` must not hold or fail `deploy_on_push` / `release-production`. The
//! eleven deploy packages this aggregate reuses are already pushed by
//! `build-service-binaries`; this workflow exists for the five local-only
//! closures and the `buildEnv` wrapper. Cursor Cloud's `.cursor` scripts
//! substitute them from the cache instead of compiling. Generated into
//! `push_local_stack_binaries.yml`.
//!
//! Runs hourly, not on every push. A build that changes Rust takes about 30
//! minutes and main takes several pushes in that time, so a run per push
//! cancelled the one before it and most main commits showed a cancelled check.
//!
//! Each run builds the newest main commit whose `Deploy on Push` run built its
//! service binaries, not main's head: most deploy runs are cancelled while they
//! wait, so main's head usually has no deploy closures in the cache and the
//! run compiled all eleven again. The cache trails that commit by up to an
//! hour plus the build.

use gh_workflow::{
    Concurrency, Event, Expression, Job, Level, Permissions, Schedule, Step, Workflow,
    WorkflowDispatch,
};

use crate::workflows::{runners, steps};

#[cfg(test)]
mod test;

/// Off the hour, when GitHub delays fewer scheduled runs.
const HOURLY: &str = "17 * * * *";

/// Ends a stuck build. GitHub keeps one waiting run per concurrency group and
/// cancels it when a newer one queues, so a build that outlasts the next tick
/// risks a cancelled run. The longest successful build took 78 minutes.
const TIMEOUT_MINUTES: u32 = 110;

/// Derivations built at once. Nix defaults to one, which compiled the five
/// local-only binaries one after another; each rustc still uses every core.
const MAX_JOBS: &str = "4";

/// Build the workflow.
pub fn push_local_stack_binaries() -> Workflow {
    Workflow::new("Push local stack binaries")
        .permissions(Permissions {
            contents: Some(Level::Read),
            actions: Some(Level::Read),
            ..Default::default()
        })
        .on(Event::default()
            .add_schedule(Schedule::new(HOURLY))
            .workflow_dispatch(WorkflowDispatch::default()))
        // Never cancel a build in progress. The next tick or dispatch waits
        // for it (a newer one replaces a waiting one) and builds only what
        // changed.
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
        .add_step(
            Step::new("Pick the commit Deploy on Push built")
                .run(steps::node_script(include_str!(
                    "scripts/local_stack_commit.ts"
                )))
                .shell("bash")
                .id("commit")
                // Without a pick (no Node, an API outage), build main's head.
                .continue_on_error(true)
                .add_env(("GH_TOKEN", "${{ github.token }}"))
                .add_env(("MAIN_SHA", "${{ github.sha }}")),
        )
        .add_step(steps::checkout_ref(
            "${{ steps.commit.outputs.sha || github.sha }}",
        ))
        .add_step(steps::mount_nix_cache_volume())
        .add_step(steps::setup_nix_with_cache())
        .add_step(steps::nix_build(
            "Build local stack binaries",
            MAX_JOBS,
            "\".#local-stack-binaries\"",
            "Local stack binaries realised into /nix/store.",
        ))
        .add_step(steps::push_nix_cache(".#local-stack-binaries"))
        .add_step(steps::teardown_nix())
}
