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

use anyhow::Result;
use gh_workflow::{
    Concurrency, Event, Expression, Job, Run, Step, Use, Workflow, WorkflowCall, WorkflowDispatch,
};

use crate::workflows::{runners, steps, vars};

#[cfg(test)]
mod test;

const ENVIRONMENT: &str = "${{ inputs.environment || 'dev' }}";

pub fn deploy_sync_service() -> Workflow {
    Workflow::new("Deploy Sync Service")
        // The `workflow_call` / `workflow_dispatch` input blocks are filled in
        // by `patch` below.
        .on(Event::default()
            .workflow_dispatch(WorkflowDispatch::default())
            .workflow_call(WorkflowCall::default()))
        .concurrency(
            // Literal prefix rather than `github.workflow`: for workflow_call
            // runs that expression expands to the *caller's* name.
            Concurrency::new(Expression::new(format!(
                "deploy-sync-service-{ENVIRONMENT}"
            ))),
        )
        .add_job("deploy", deploy())
}

pub fn patch(root: &mut serde_yaml::Value) -> Result<()> {
    let on = root
        .get_mut("on")
        .and_then(serde_yaml::Value::as_mapping_mut)
        .ok_or_else(|| anyhow::anyhow!("rendered workflow has no `on` mapping"))?;
    on.insert(
        "workflow_call".into(),
        crate::workflows::yaml_fragment(indoc::indoc! {r#"
            inputs:
              environment:
                required: true
                type: string
                description: The environment to deploy to. e.g. (dev, prod)
            secrets:
              CLOUDFLARE_API_TOKEN:
                required: true
        "#})?,
    );
    on.insert(
        "workflow_dispatch".into(),
        crate::workflows::yaml_fragment(indoc::indoc! {r#"
            inputs:
              environment:
                required: true
                type: choice
                default: 'dev'
                options:
                  - dev
                  - prod
                description: The environment to deploy to
        "#})?,
    );
    Ok(())
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
    Step::new("Setup Node")
        .uses("actions", "setup-node", "v4")
        .add_with(("node-version", "22"))
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
        .run(format!(
            "node scripts/check-deploy-secrets.mjs {ENVIRONMENT}"
        ))
        .working_directory(xtask_paths::repo_dir!("services/sync-service"))
        .add_env(("CLOUDFLARE_API_TOKEN", vars::CLOUDFLARE_API_TOKEN))
        .add_env(("CLOUDFLARE_ACCOUNT_ID", vars::CLOUDFLARE_ACCOUNT_ID))
}

const WORKER_CHANGED: &str = "${{ steps.worker-state.outputs.unchanged != 'true' }}";

/// A failure here leaves the key empty, which the next step treats as changed.
fn compute_worker_key() -> Step<Run> {
    Step::new("Compute worker input key")
        .run("echo \"key=$(.github/scripts/sync-worker-key.sh)\" >> \"$GITHUB_OUTPUT\"")
        .id("worker-key")
        .continue_on_error(true)
}

fn read_worker_state() -> Step<Run> {
    Step::new("Compare with the live worker")
        .run("../../.github/scripts/sync-worker-state.sh")
        .id("worker-state")
        .working_directory(xtask_paths::repo_dir!("services/sync-service"))
        .add_env(("ENVIRONMENT", ENVIRONMENT))
        .add_env(("WORKER_KEY", "${{ steps.worker-key.outputs.key }}"))
        .add_env(("CLOUDFLARE_API_TOKEN", vars::CLOUDFLARE_API_TOKEN))
        .add_env(("CLOUDFLARE_ACCOUNT_ID", vars::CLOUDFLARE_ACCOUNT_ID))
}

/// Migrate first: new code against an already-migrated D1 is safe, the reverse
/// is a live error.
fn apply_d1_migrations() -> Step<Run> {
    Step::new("Apply D1 migrations")
        .run(format!(
            "npx wrangler d1 migrations apply USER_PEER_MAPPING --env {ENVIRONMENT} --remote"
        ))
        .if_condition(Expression::new(WORKER_CHANGED))
        .working_directory(xtask_paths::repo_dir!("services/sync-service"))
        .add_env(("CI", "true"))
        .add_env(("CLOUDFLARE_API_TOKEN", vars::CLOUDFLARE_API_TOKEN))
        .add_env(("CLOUDFLARE_ACCOUNT_ID", vars::CLOUDFLARE_ACCOUNT_ID))
}

fn deploy_step() -> Step<Run> {
    Step::new("Deploy with wrangler")
        .run(format!(
            "npx wrangler deploy --env {ENVIRONMENT} --message \"inputs:$WORKER_KEY\""
        ))
        .if_condition(Expression::new(WORKER_CHANGED))
        .working_directory(xtask_paths::repo_dir!("services/sync-service"))
        .add_env(("WORKER_KEY", "${{ steps.worker-key.outputs.key }}"))
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
        .add_env((
            "WAIT_SECONDS",
            "${{ steps.worker-state.outputs.wait_seconds }}",
        ))
}
