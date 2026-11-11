//! `Deploy MCP ChatGPT Worker` — deploys the `mcp-chatgpt-worker` Cloudflare
//! Worker (`services/mcp-chatgpt-worker`) via wrangler. Generated into
//! `deploy_mcp_chatgpt_worker.yml`.
//!
//! Dispatch-only until the server launches: merging never deploys it. Once it
//! serves ChatGPT, add the path-gated push for `dev` and the
//! `release-production` call for `prod` that
//! [`crate::workflows::deploy_ai_editing_worker`] has.

use anyhow::Result;
use gh_workflow::{
    Concurrency, Event, Expression, Job, Run, Step, Use, Workflow, WorkflowDispatch,
};

use crate::workflows::{runners, steps, vars};

const ENVIRONMENT: &str = "${{ inputs.environment }}";

/// Build the workflow.
pub fn deploy_mcp_chatgpt_worker() -> Workflow {
    Workflow::new("Deploy MCP ChatGPT Worker")
        // The dispatch input block is filled in by `patch` below.
        .on(Event::default().workflow_dispatch(WorkflowDispatch::default()))
        .concurrency(
            Concurrency::new(Expression::new(format!(
                "deploy-mcp-chatgpt-worker-{ENVIRONMENT}"
            )))
            .cancel_in_progress(false),
        )
        .add_job("deploy", deploy())
}

/// The `choice` dispatch input `gh_workflow` cannot express.
pub fn patch(root: &mut serde_yaml::Value) -> Result<()> {
    let on = root
        .get_mut("on")
        .and_then(serde_yaml::Value::as_mapping_mut)
        .ok_or_else(|| anyhow::anyhow!("rendered workflow has no `on` mapping"))?;
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
    // The root workspace, and the standalone SDK the tool generator reads.
    Step::new("Install dependencies")
        .run("bun install --frozen-lockfile && (cd packages/sdk && bun install --frozen-lockfile)")
}

fn deploy_step() -> Step<Run> {
    // wrangler's build command generates the SDK tool catalog first.
    Step::new("Deploy with wrangler")
        .run(format!("bunx wrangler deploy --env {ENVIRONMENT}"))
        .working_directory(xtask_paths::repo_dir!("services/mcp-chatgpt-worker"))
        .add_env(("CLOUDFLARE_API_TOKEN", vars::CLOUDFLARE_API_TOKEN))
        .add_env(("CLOUDFLARE_ACCOUNT_ID", vars::CLOUDFLARE_ACCOUNT_ID))
}
