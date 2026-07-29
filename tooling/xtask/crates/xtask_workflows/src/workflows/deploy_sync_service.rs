//! `Deploy Sync Service` — deploys the `sync_service` Cloudflare Worker
//! (`services/sync-service`) via wrangler, applying its D1 migrations first.
//! Unlike [`crate::workflows::deploy_ai_editing_worker`] this worker is Rust, so
//! the job needs a toolchain and the wasm target. Generated into
//! `deploy_sync_service.yml`.

use anyhow::Result;
use gh_workflow::{Concurrency, Event, Expression, Job, Push, Run, Step, Use, Workflow};

use crate::workflows::{runners, steps, vars};

const ENVIRONMENT: &str = "${{ inputs.environment || 'dev' }}";

pub fn deploy_sync_service() -> Workflow {
    Workflow::new("Deploy Sync Service")
        .on(Event::default()
            // Only redeploy when the worker, its one path dependency, or the
            // workspace's Rust pinning changes.
            .push(
                Push::default()
                    .add_branch("main")
                    .add_path(xtask_paths::repo_glob!(
                        ".github/workflows/deploy_sync_service.yml"
                    ))
                    .add_path(xtask_paths::repo_glob!("services/sync-service/**"))
                    .add_path(xtask_paths::repo_glob!("crates/macro_sync_service_jwt/**"))
                    .add_path(xtask_paths::repo_glob!("Cargo.toml"))
                    .add_path(xtask_paths::repo_glob!("Cargo.lock"))
                    .add_path(xtask_paths::repo_glob!("rust-toolchain.toml")),
            ))
        // The `workflow_call` / `workflow_dispatch` input blocks are filled in
        // by `patch` below.
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
        .add_step(apply_d1_migrations())
        .add_step(deploy_step())
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

/// Migrate first: new code against an already-migrated D1 is safe, the reverse
/// is a live error.
fn apply_d1_migrations() -> Step<Run> {
    Step::new("Apply D1 migrations")
        .run(format!(
            "npx wrangler d1 migrations apply USER_PEER_MAPPING --env {ENVIRONMENT} --remote"
        ))
        .working_directory(xtask_paths::repo_dir!("services/sync-service"))
        .add_env(("CI", "true"))
        .add_env(("CLOUDFLARE_API_TOKEN", vars::CLOUDFLARE_API_TOKEN))
        .add_env(("CLOUDFLARE_ACCOUNT_ID", vars::CLOUDFLARE_ACCOUNT_ID))
}

fn deploy_step() -> Step<Run> {
    Step::new("Deploy with wrangler")
        .run(format!("npx wrangler deploy --env {ENVIRONMENT}"))
        .working_directory(xtask_paths::repo_dir!("services/sync-service"))
        .add_env(("CLOUDFLARE_API_TOKEN", vars::CLOUDFLARE_API_TOKEN))
        .add_env(("CLOUDFLARE_ACCOUNT_ID", vars::CLOUDFLARE_ACCOUNT_ID))
}
