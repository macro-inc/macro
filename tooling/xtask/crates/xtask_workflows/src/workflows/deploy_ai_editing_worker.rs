//! `Deploy AI Editing Worker` — deploys the `ai-editing-worker` Cloudflare
//! Worker (`services/ai-editing-worker`) via wrangler. Generated into
//! `deploy_ai_editing_worker.yml`.
//!
//! Push to `main` (path-gated) auto-deploys `dev`; prod deploys come through
//! `release-production`, which calls this workflow with `environment: prod` —
//! the same split [`crate::workflows::deploy_sync_service`] uses. Manual
//! `workflow_dispatch` picks either env from a `choice` input. Runs on the small
//! profile — a bun install plus `wrangler deploy`, no Nix or cache volume
//! needed.
//!
//! Prod used to be dispatch-only, and nothing ever dispatched it — the worker ran
//! ten-day-old code while `release-production` shipped its Rust caller.

use anyhow::Result;
use gh_workflow::{
    Concurrency, Event, Expression, Job, Push, Run, Step, Use, Workflow, WorkflowCall,
    WorkflowDispatch,
};

use crate::workflows::{runners, steps, vars};

const ENVIRONMENT: &str = "${{ inputs.environment || 'dev' }}";

/// Build the workflow.
pub fn deploy_ai_editing_worker() -> Workflow {
    Workflow::new("Deploy AI Editing Worker")
        .on(Event::default()
            // Only redeploy when the worker or something it bundles changes.
            // Paths cover the worker and every workspace package it bundles.
            .push(
                Push::default()
                    .add_branch("main")
                    .add_path(xtask_paths::repo_glob!(
                        ".github/workflows/deploy_ai_editing_worker.yml"
                    ))
                    .add_path(xtask_paths::repo_glob!("bun.lock"))
                    .add_path(xtask_paths::repo_glob!("package.json"))
                    .add_path(xtask_paths::repo_glob!("services/ai-editing-worker/**"))
                    .add_path(xtask_paths::repo_glob!("packages/collaboration/**"))
                    .add_path(xtask_paths::repo_glob!("packages/lexical-core/**"))
                    .add_path(xtask_paths::repo_glob!("packages/loro-mirror/**")),
            )
            // The `workflow_call` / `workflow_dispatch` input blocks are filled
            // in by `patch` below.
            .workflow_dispatch(WorkflowDispatch::default())
            .workflow_call(WorkflowCall::default()))
        .concurrency(
            // Literal prefix rather than `github.workflow`: for workflow_call
            // runs that expression expands to the *caller's* name.
            Concurrency::new(Expression::new(format!(
                "deploy-ai-editing-worker-{ENVIRONMENT}"
            )))
            .cancel_in_progress(false),
        )
        .add_job("deploy", deploy())
}

/// Input blocks `gh_workflow` cannot express: a `choice` dispatch input, and the
/// `workflow_call` contract `release-production` deploys prod through.
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
        .runs_on(runners::Runner::Small.to_string())
        .add_step(steps::checkout(false, false))
        .add_step(steps::setup_bun())
        .add_step(setup_node())
        .add_step(install_deps())
        .add_step(deploy_step())
}

fn setup_node() -> Step<Use> {
    Step::new("Setup Node")
        .uses("actions", "setup-node", "v4")
        .add_with(("node-version", "22"))
}

fn install_deps() -> Step<Run> {
    Step::new("Install dependencies").run("bun install --frozen-lockfile")
}

fn deploy_step() -> Step<Run> {
    // On push, `inputs.environment` is empty, so this deploys `dev`. Dispatch and
    // `release-production` pass it explicitly. `deploy-<env>` regenerates the
    // sandbox before `wrangler deploy` (see
    // services/ai-editing-worker/package.json).
    Step::new("Deploy with wrangler")
        .run(format!("bun run deploy-{ENVIRONMENT}"))
        .working_directory(xtask_paths::repo_dir!("services/ai-editing-worker"))
        .add_env(("CLOUDFLARE_API_TOKEN", vars::CLOUDFLARE_API_TOKEN))
        .add_env(("CLOUDFLARE_ACCOUNT_ID", vars::CLOUDFLARE_ACCOUNT_ID))
}
