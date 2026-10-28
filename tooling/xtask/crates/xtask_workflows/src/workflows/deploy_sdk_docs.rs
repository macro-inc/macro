//! Publish the TypeDoc site to its Cloudflare Worker from reviewed main commits.

use gh_workflow::{
    Concurrency, Event, Expression, Job, Level, Permissions, Push, Step, Workflow, WorkflowDispatch,
};

use crate::workflows::{runners, steps, vars};

#[cfg(test)]
mod test;

/// Build the production documentation deployment workflow.
pub fn deploy_sdk_docs() -> Workflow {
    Workflow::new("Deploy SDK Docs")
        .on(Event::default()
            .push(
                Push::default()
                    .add_branch("main")
                    .add_path(xtask_paths::repo_glob!(
                        ".github/workflows/deploy_sdk_docs.yml"
                    ))
                    .add_path(xtask_paths::repo_glob!("packages/sdk/**"))
                    .add_path(xtask_paths::repo_glob!("packages/sdk-docs/**"))
                    .add_path(xtask_paths::repo_file!("bun.lock"))
                    .add_path(xtask_paths::repo_file!("package.json")),
            )
            .workflow_dispatch(WorkflowDispatch::default()))
        .concurrency(
            Concurrency::new(Expression::new("${{ github.workflow }}")).cancel_in_progress(false),
        )
        .add_job(
            "deploy",
            Job::default()
                .name("Deploy SDK documentation")
                .cond(Expression::new("${{ github.ref == 'refs/heads/main' }}"))
                .runs_on(runners::Runner::Small.to_string())
                .permissions(Permissions {
                    contents: Some(Level::Read),
                    ..Default::default()
                })
                .add_step(steps::checkout(false, false))
                .add_step(steps::setup_bun())
                .add_step(
                    Step::new("Setup Node")
                        .uses("actions", "setup-node", "v4")
                        .add_with(("node-version", "22")),
                )
                .add_step(Step::new("Install dependencies").run("bun install --frozen-lockfile"))
                .add_step(
                    Step::new("Verify documentation")
                        .run("bun run type-check && bun run test")
                        .working_directory(xtask_paths::repo_dir!("packages/sdk-docs")),
                )
                .add_step(
                    Step::new("Deploy with wrangler")
                        .run("bun run docs:deploy")
                        .working_directory(xtask_paths::repo_dir!("packages/sdk-docs"))
                        .add_env(("CLOUDFLARE_API_TOKEN", vars::CLOUDFLARE_API_TOKEN))
                        .add_env(("CLOUDFLARE_ACCOUNT_ID", vars::CLOUDFLARE_ACCOUNT_ID)),
                ),
        )
}
