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

use gh_workflow::expr::typed::{Expr, Str, input};
use gh_workflow::{
    Concurrency, Event, Job, Push, Run, Step, Use, Workflow, WorkflowCall, WorkflowCallSecret,
    WorkflowDispatch, WorkflowInput,
};

use crate::workflows::actions::ActionsSetupNode;
use crate::workflows::{runners, steps, vars};

/// Dispatches and calls both pass one; `dev` is the fallback.
fn environment() -> Expr<Str> {
    input::<Str>("environment").or_else("dev")
}

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
                    .add_path(xtask_paths::repo_glob!("packages/spreadsheet/**"))
                    .add_path(xtask_paths::repo_glob!("packages/loro-mirror/**")),
            )
            // The `workflow_call` / `workflow_dispatch` input blocks are filled
            // in by `patch` below.
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
            Concurrency::new(format!("deploy-ai-editing-worker-{}", environment()))
                .cancel_in_progress(false),
        )
        .add_job("deploy", deploy())
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
    ActionsSetupNode::new("Setup Node")
        .node_version("22")
        .step()
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
        .run("bun run \"deploy-$DEPLOY_ENVIRONMENT\"")
        .working_directory(xtask_paths::repo_dir!("services/ai-editing-worker"))
        .add_env(("DEPLOY_ENVIRONMENT", environment()))
        .add_env(("CLOUDFLARE_API_TOKEN", vars::CLOUDFLARE_API_TOKEN))
        .add_env(("CLOUDFLARE_ACCOUNT_ID", vars::CLOUDFLARE_ACCOUNT_ID))
}
