//! `Deploy Sync Service` — deploys the `sync_service` Cloudflare Worker
//! (`services/sync-service`) via wrangler, applying its D1 migrations first.
//! Unlike [`crate::workflows::deploy_ai_editing_worker`] this worker is Rust, so
//! the job needs a toolchain and the wasm target. Call/dispatch-only: push
//! deploys to dev come through [`crate::workflows::deploy_on_push`] (which owns
//! deployment ordering) and prod deploys through `release-production`. Generated
//! into `deploy_sync_service.yml`.
//!
//! The job skips migrations, deployment and the wait when the live worker was
//! built from the same inputs. It compares with the version Cloudflare is
//! serving, not with the previous push, so runs that were cancelled in the
//! queue can't make an undeployed change look deployed.

use gh_workflow::expr::typed::{Bool, Expr, Flag, StepHandle, StepOutput, Str, input};
use gh_workflow::{
    Concurrency, Event, Job, Run, Step, Use, Workflow, WorkflowCall, WorkflowCallSecret,
    WorkflowDispatch, WorkflowInput,
};

use crate::workflows::actions::ActionsSetupNode;
use crate::workflows::{runners, steps, vars};

#[cfg(test)]
mod test;

/// Dispatches and calls both pass one; `dev` is the fallback.
fn environment() -> Expr<Str> {
    input::<Str>("environment").or_else("dev")
}

pub fn deploy_sync_service() -> Workflow {
    Workflow::new("Deploy Sync Service")
        // The `workflow_call` / `workflow_dispatch` input blocks are filled in
        // by `patch` below.
        .on(Event::default()
            .workflow_dispatch(
                WorkflowDispatch::default().add_input(
                    "environment",
                    WorkflowInput::choice(["dev", "prod"])
                        .description("The environment to deploy to")
                        .required(true)
                        .default("dev"),
                ),
            )
            .workflow_call(
                WorkflowCall::default()
                    .add_input(
                        "environment",
                        WorkflowInput::string()
                            .description("The environment to deploy to. e.g. (dev, prod)")
                            .required(true),
                    )
                    .add_secret(
                        "CLOUDFLARE_API_TOKEN",
                        WorkflowCallSecret::default().required(true),
                    ),
            ))
        .concurrency(
            // Literal prefix rather than `github.workflow`: for workflow_call
            // runs that expression expands to the *caller's* name.
            Concurrency::new(format!("deploy-sync-service-{}", environment())),
        )
        .add_job("deploy", deploy())
}

fn deploy() -> Job {
    Job::default()
        .name("Deploy to Cloudflare")
        .runs_on(runners::Runner::Mid.with_cache_tag(vars::SYNC_SERVICE_CACHE_TAG))
        .add_step(steps::checkout(false, false))
        .add_step(steps::mount_wasm_cache_volume())
        .add_step(steps::setup_rust_light())
        .add_step(add_wasm_target())
        .add_step(setup_node())
        .add_step(install_deps())
        .add_step(check_secrets())
        .add_step(compute_worker_key())
        .add_step(read_worker_state())
        .add_step(apply_d1_migrations())
        .add_step(deploy_step())
        .add_step(wait_for_active_objects())
}

/// [`steps::setup_rust_light`] installs the channel explicitly, which skips
/// `rust-toolchain.toml`'s `targets`.
fn add_wasm_target() -> Step<Run> {
    Step::new("Add wasm32 target").run("rustup target add wasm32-unknown-unknown")
}

fn setup_node() -> Step<Use> {
    ActionsSetupNode::new("Setup Node")
        .node_version("22")
        .step()
}

/// sync-service keeps its own `package-lock.json` rather than joining the root
/// bun workspace, so install it here instead of relying on hoisting.
fn install_deps() -> Step<Run> {
    Step::new("Install dependencies")
        .run("npm ci")
        .working_directory(xtask_paths::repo_dir!("services/sync-service"))
}

/// Fail before migrations or deployment if commenter validation cannot authenticate.
fn check_secrets() -> Step<Run> {
    Step::new("Check required secrets")
        .run("node scripts/check-deploy-secrets.mjs \"$DEPLOY_ENVIRONMENT\"")
        .working_directory(xtask_paths::repo_dir!("services/sync-service"))
        .add_env(("DEPLOY_ENVIRONMENT", environment()))
        .add_env(("CLOUDFLARE_API_TOKEN", vars::CLOUDFLARE_API_TOKEN))
        .add_env(("CLOUDFLARE_ACCOUNT_ID", vars::CLOUDFLARE_ACCOUNT_ID))
}

pub(crate) struct WorkerKeyOutputs {
    /// The worker's input key, empty when it couldn't be computed.
    pub key: StepOutput<Str>,
}

/// The step that computes the worker's input key.
pub(crate) const WORKER_KEY: StepHandle<WorkerKeyOutputs> = StepHandle::new(
    "worker-key",
    WorkerKeyOutputs {
        key: StepOutput::new("worker-key", "key"),
    },
);

pub(crate) struct WorkerStateOutputs {
    /// Whether the live worker was built from the same inputs.
    pub unchanged: StepOutput<Flag>,
    /// Seconds left before active Durable Objects run the live version.
    pub wait_seconds: StepOutput<Str>,
}

/// The step that compares the inputs with the live worker.
pub(crate) const WORKER_STATE: StepHandle<WorkerStateOutputs> = StepHandle::new(
    "worker-state",
    WorkerStateOutputs {
        unchanged: StepOutput::new("worker-state", "unchanged"),
        wait_seconds: StepOutput::new("worker-state", "wait_seconds"),
    },
);

fn worker_changed() -> Expr<Bool> {
    WORKER_STATE.outputs.unchanged.read().is_unset()
}

/// A failure here leaves the key empty, which the next step treats as changed.
fn compute_worker_key() -> Step<Run> {
    Step::new("Compute worker input key")
        .run("echo \"key=$(.github/scripts/sync-worker-key.sh)\" >> \"$GITHUB_OUTPUT\"")
        .id(WORKER_KEY.id())
        .continue_on_error(true)
}

fn read_worker_state() -> Step<Run> {
    Step::new("Compare with the live worker")
        .run("../../.github/scripts/sync-worker-state.sh")
        .id(WORKER_STATE.id())
        .working_directory(xtask_paths::repo_dir!("services/sync-service"))
        .add_env(("ENVIRONMENT", environment()))
        .add_env(("WORKER_KEY", WORKER_KEY.outputs.key.read()))
        .add_env(("CLOUDFLARE_API_TOKEN", vars::CLOUDFLARE_API_TOKEN))
        .add_env(("CLOUDFLARE_ACCOUNT_ID", vars::CLOUDFLARE_ACCOUNT_ID))
}

/// Migrate first: new code against an already-migrated D1 is safe, the reverse
/// is a live error.
fn apply_d1_migrations() -> Step<Run> {
    Step::new("Apply D1 migrations")
        .run(
            "npx wrangler d1 migrations apply USER_PEER_MAPPING --env \"$DEPLOY_ENVIRONMENT\" --remote",
        )
        .if_condition(worker_changed())
        .working_directory(xtask_paths::repo_dir!("services/sync-service"))
        .add_env(("DEPLOY_ENVIRONMENT", environment()))
        .add_env(("CI", "true"))
        .add_env(("CLOUDFLARE_API_TOKEN", vars::CLOUDFLARE_API_TOKEN))
        .add_env(("CLOUDFLARE_ACCOUNT_ID", vars::CLOUDFLARE_ACCOUNT_ID))
}

fn deploy_step() -> Step<Run> {
    Step::new("Deploy with wrangler")
        .run("npx wrangler deploy --env \"$DEPLOY_ENVIRONMENT\" --message \"inputs:$WORKER_KEY\"")
        .if_condition(worker_changed())
        .working_directory(xtask_paths::repo_dir!("services/sync-service"))
        .add_env(("DEPLOY_ENVIRONMENT", environment()))
        .add_env(("WORKER_KEY", WORKER_KEY.outputs.key.read()))
        .add_env(("CLOUDFLARE_API_TOKEN", vars::CLOUDFLARE_API_TOKEN))
        .add_env(("CLOUDFLARE_ACCOUNT_ID", vars::CLOUDFLARE_ACCOUNT_ID))
}

/// Active Durable Objects can defer code adoption for 300 seconds by default.
/// Keep dependent clients behind that window without forcing sessions to reset
/// early. Keep this delay aligned with any future `code_update_strategy` change.
/// `sync-worker-state.sh` holds the 300 seconds; a skipped deployment waits only
/// for what remains since the live version was deployed.
fn wait_for_active_objects() -> Step<Run> {
    Step::new("Wait for active Durable Objects to update")
        .run("sleep \"$WAIT_SECONDS\"")
        .add_env(("WAIT_SECONDS", WORKER_STATE.outputs.wait_seconds.read()))
}
