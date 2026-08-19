//! `Deploy CLA Worker` — deploys the `cla-worker` Cloudflare Worker
//! (`services/cla-worker`) via wrangler. Generated into
//! `deploy_cla_worker.yml`.
//!
//! Push to `main` (path-gated) auto-deploys; `workflow_dispatch` allows a
//! manual redeploy. There is a single production instance — the worker is a
//! legal-record store, not something with meaningful dev/prod split. The
//! `deploy` script applies pending D1 migrations before `wrangler deploy`.

use gh_workflow::{
    Concurrency, Event, Expression, Job, Push, Run, Step, Use, Workflow, WorkflowDispatch,
};

use crate::workflows::{runners, steps, vars};

/// Build the workflow.
pub fn deploy_cla_worker() -> Workflow {
    Workflow::new("Deploy CLA Worker")
        .on(Event::default()
            .push(
                Push::default()
                    .add_branch("main")
                    .add_path(xtask_paths::repo_glob!(
                        ".github/workflows/deploy_cla_worker.yml"
                    ))
                    .add_path(xtask_paths::repo_glob!("services/cla-worker/**")),
            )
            .workflow_dispatch(WorkflowDispatch::default()))
        .concurrency(
            Concurrency::new(Expression::new("${{ github.workflow }}")).cancel_in_progress(false),
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
    Step::new("Setup Node")
        .uses("actions", "setup-node", "v4")
        .add_with(("node-version", "22"))
}

fn install_deps() -> Step<Run> {
    Step::new("Install dependencies")
        .run("bun install --frozen-lockfile")
        .working_directory(xtask_paths::repo_dir!("services/cla-worker"))
}

fn deploy_step() -> Step<Run> {
    Step::new("Deploy with wrangler")
        .run("bun run deploy")
        .working_directory(xtask_paths::repo_dir!("services/cla-worker"))
        .add_env(("CLOUDFLARE_API_TOKEN", vars::CLOUDFLARE_API_TOKEN))
        .add_env(("CLOUDFLARE_ACCOUNT_ID", vars::CLOUDFLARE_ACCOUNT_ID))
}
