//! `Deploy AI Editing Worker` — deploys the `ai-editing-worker` Cloudflare
//! Worker (`js/ai-editing-worker`) via wrangler. Generated into
//! `deploy_ai_editing_worker.yml`.
//!
//! Push to `main` (path-gated) auto-deploys `dev`; `workflow_dispatch` picks the
//! target env via a `string` input (`dev` or `prod`, defaults to `dev`). Runs on
//! the small profile — a bun install plus `wrangler deploy`, no Nix or cache
//! volume needed.

use std::collections::HashMap;

use gh_workflow::{
    Concurrency, Event, Expression, Job, Push, Run, Step, Use, Workflow, WorkflowDispatch,
    WorkflowDispatchInput,
};

use crate::workflows::{runners, steps, vars};

/// Build the workflow.
pub fn deploy_ai_editing_worker() -> Workflow {
    Workflow::new("Deploy AI Editing Worker")
        .on(Event::default()
            // Only redeploy when the worker or something it bundles changes.
            // Paths mirror the wrangler aliases in
            // `js/ai-editing-worker/wrangler.toml`.
            .push(
                Push::default()
                    .add_branch("main")
                    .add_path(".github/workflows/deploy_ai_editing_worker.yml")
                    .add_path("js/bun.lock")
                    .add_path("js/package.json")
                    .add_path("js/ai-editing-worker/**")
                    .add_path("js/app/packages/core/**")
                    .add_path("js/app/packages/websocket/**")
                    .add_path("js/loro-mirror/**"),
            )
            .workflow_dispatch(WorkflowDispatch::default().inputs(HashMap::from([(
                "environment".to_string(),
                // Struct literal, not the builder: the `Setters`-derived
                // `default` setter collides with `Default::default()`.
                WorkflowDispatchInput {
                    description: "Environment to deploy (dev or prod)".to_string(),
                    required: false,
                    input_type: "string".to_string(),
                    default: Some("dev".to_string()),
                },
            )]))))
        .concurrency(
            Concurrency::new(Expression::new(
                "${{ github.workflow }}-${{ inputs.environment || 'dev' }}",
            ))
            .cancel_in_progress(false),
        )
        .add_job("deploy", deploy())
}

fn deploy() -> Job {
    Job::default()
        .name("Deploy to Cloudflare")
        .runs_on(runners::Runner::Small.to_string())
        .add_step(steps::checkout(false, false))
        .add_step(setup_bun())
        .add_step(install_deps())
        .add_step(install_worker_deps())
        .add_step(deploy_step())
}

fn setup_bun() -> Step<Use> {
    Step::new("Setup Bun").uses("oven-sh", "setup-bun", "v2")
}

fn install_deps() -> Step<Run> {
    Step::new("Install dependencies")
        .run("bun install --frozen-lockfile")
        .working_directory("js")
}

fn install_worker_deps() -> Step<Run> {
    Step::new("Install worker dependencies")
        .run("bun install --frozen-lockfile")
        .working_directory("js/ai-editing-worker")
}

fn deploy_step() -> Step<Run> {
    // On push, `inputs.environment` is empty, so this deploys `dev`. Manual
    // dispatch picks dev or prod. `deploy-<env>` regenerates the sandbox before
    // `wrangler deploy` (see js/ai-editing-worker/package.json).
    Step::new("Deploy with wrangler")
        .run("bun run deploy-${{ inputs.environment || 'dev' }}")
        .working_directory("js/ai-editing-worker")
        .add_env(("CLOUDFLARE_API_TOKEN", vars::CLOUDFLARE_API_TOKEN))
        .add_env(("CLOUDFLARE_ACCOUNT_ID", vars::CLOUDFLARE_ACCOUNT_ID))
}
