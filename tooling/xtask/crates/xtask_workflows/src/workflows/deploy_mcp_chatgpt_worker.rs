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

use anyhow::Result;
use gh_workflow::{
    Concurrency, Event, Expression, Job, Run, Step, Use, Workflow, WorkflowCall, WorkflowDispatch,
};

use crate::workflows::{runners, steps, vars};

#[cfg(test)]
mod test;

const ENVIRONMENT: &str = "${{ inputs.environment || 'dev' }}";

/// Build the workflow.
pub fn deploy_mcp_chatgpt_worker() -> Workflow {
    Workflow::new("Deploy MCP ChatGPT Worker")
        // The `workflow_call` / `workflow_dispatch` input blocks are filled in
        // by `patch` below.
        .on(Event::default()
            .workflow_dispatch(WorkflowDispatch::default())
            .workflow_call(WorkflowCall::default()))
        .concurrency(
            // Literal prefix rather than `github.workflow`: for workflow_call
            // runs that expression expands to the *caller's* name.
            Concurrency::new(Expression::new(format!(
                "deploy-mcp-chatgpt-worker-{ENVIRONMENT}"
            )))
            .cancel_in_progress(false),
        )
        .add_job("deploy", deploy())
}

/// Input blocks `gh_workflow` cannot express: a `choice` dispatch input, and the
/// `workflow_call` contract `deploy-on-push` and `release-production` use.
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
        .add_step(check_secrets())
        .add_step(deploy_step())
}

fn setup_node() -> Step<Use> {
    Step::new("Setup Node")
        .uses("actions", "setup-node", "v4")
        .add_with(("node-version", "22"))
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
        .run(format!(
            "node scripts/check-deploy-secrets.mjs {ENVIRONMENT}"
        ))
        .working_directory(xtask_paths::repo_dir!("services/mcp-chatgpt-worker"))
        .add_env(("CLOUDFLARE_API_TOKEN", vars::CLOUDFLARE_API_TOKEN))
        .add_env(("CLOUDFLARE_ACCOUNT_ID", vars::CLOUDFLARE_ACCOUNT_ID))
}

fn deploy_step() -> Step<Run> {
    // On a direct dispatch `inputs.environment` is set; callers pass it too.
    // wrangler's build command generates the SDK tool catalog first.
    Step::new("Deploy with wrangler")
        .run(format!("bunx wrangler deploy --env {ENVIRONMENT}"))
        .working_directory(xtask_paths::repo_dir!("services/mcp-chatgpt-worker"))
        .add_env(("CLOUDFLARE_API_TOKEN", vars::CLOUDFLARE_API_TOKEN))
        .add_env(("CLOUDFLARE_ACCOUNT_ID", vars::CLOUDFLARE_ACCOUNT_ID))
}
