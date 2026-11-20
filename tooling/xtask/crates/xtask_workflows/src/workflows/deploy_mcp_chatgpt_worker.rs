//! `Deploy MCP ChatGPT Worker` — deploys the `mcp-chatgpt-worker` Cloudflare
//! Worker (`services/mcp-chatgpt-worker`) via wrangler. Generated into
//! `deploy_mcp_chatgpt_worker.yml`.
//!
//! Deploys the way [`crate::workflows::deploy_sync_service`] does: call/dispatch
//! only. Push deploys to dev come through [`crate::workflows::deploy_on_push`]
//! (unconditionally, like every stage there) and prod deploys through
//! `release-production`. Manual `workflow_dispatch` picks either env.
//!
//! Unlike sync-service the worker is stateless (no D1, no Durable Objects), so
//! it has no migrations, no deferral wait and no live-version comparison: every
//! run deploys. The one gate is the secrets check, which fails the job before
//! `wrangler deploy` when a secret the worker needs outside local is missing,
//! leaving the live version serving.

use gh_workflow::expr::typed::{Expr, Str, input};
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

/// Build the workflow.
pub fn deploy_mcp_chatgpt_worker() -> Workflow {
    Workflow::new("Deploy MCP ChatGPT Worker")
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
            Concurrency::new(format!("deploy-mcp-chatgpt-worker-{}", environment()))
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
        .add_step(check_secrets())
        .add_step(deploy_step())
}

fn setup_node() -> Step<Use> {
    ActionsSetupNode::new("Setup Node")
        .node_version("22")
        .step()
}

fn install_deps() -> Step<Run> {
    // The root workspace, and the standalone SDK the tool generator reads.
    Step::new("Install dependencies")
        .run("bun install --frozen-lockfile && (cd packages/sdk && bun install --frozen-lockfile)")
}

/// Fail before deployment when the environment lacks a secret the worker needs:
/// a deployed worker without one fails every request, while a failed job leaves
/// the live version serving.
fn check_secrets() -> Step<Run> {
    Step::new("Check required secrets")
        .run("node scripts/check-deploy-secrets.mjs \"$DEPLOY_ENVIRONMENT\"")
        .working_directory(xtask_paths::repo_dir!("services/mcp-chatgpt-worker"))
        .add_env(("DEPLOY_ENVIRONMENT", environment()))
        .add_env(("CLOUDFLARE_API_TOKEN", vars::CLOUDFLARE_API_TOKEN))
        .add_env(("CLOUDFLARE_ACCOUNT_ID", vars::CLOUDFLARE_ACCOUNT_ID))
}

fn deploy_step() -> Step<Run> {
    // On a direct dispatch `inputs.environment` is set; callers pass it too.
    // wrangler's build command generates the SDK tool catalog first.
    Step::new("Deploy with wrangler")
        .run("bunx wrangler deploy --env \"$DEPLOY_ENVIRONMENT\"")
        .working_directory(xtask_paths::repo_dir!("services/mcp-chatgpt-worker"))
        .add_env(("DEPLOY_ENVIRONMENT", environment()))
        .add_env(("CLOUDFLARE_API_TOKEN", vars::CLOUDFLARE_API_TOKEN))
        .add_env(("CLOUDFLARE_ACCOUNT_ID", vars::CLOUDFLARE_ACCOUNT_ID))
}
