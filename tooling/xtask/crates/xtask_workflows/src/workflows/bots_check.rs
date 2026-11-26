//! Build and check the standalone Bots frontend without backend services.

use gh_workflow::{Event, Job, Level, Permissions, Step, Workflow, WorkflowCall};
use xtask_paths::RepoGlob;

use crate::workflows::actions::ActionsSetupNode;
use crate::workflows::steps;

/// Files whose change makes PR CI check the Bots package.
pub const PATHS: &[RepoGlob<'static>] = &[
    xtask_paths::repo_glob!("apps/bots/**"),
    xtask_paths::repo_glob!("packages/sdk/**"),
    xtask_paths::repo_glob!("apps/web/patches/@kobalte*"),
    xtask_paths::repo_glob!("biome.base.jsonc"),
    xtask_paths::repo_glob!("bun.lock"),
    xtask_paths::repo_glob!("package.json"),
    xtask_paths::repo_glob!(".github/workflows/bots-check.yml"),
];

/// Build the reusable PR check.
pub fn bots_check() -> Workflow {
    Workflow::new("Bots Check")
        .permissions(Permissions {
            contents: Some(Level::Read),
            ..Default::default()
        })
        .on(Event::default().workflow_call(WorkflowCall::default()))
        .add_job(
            "check-package",
            Job::default()
                .name("Bots Package Check")
                .runs_on("ubuntu-latest")
                .timeout_minutes(10u32)
                .add_step(steps::checkout(false, false))
                .add_step(ActionsSetupNode::new("Setup Node").node_version("24"))
                .add_step(steps::setup_bun_pinned())
                .add_step(
                    Step::new("Install dependencies").run(
                        "bun install --frozen-lockfile --ignore-scripts --filter @macro-inc/bots",
                    ),
                )
                .add_step(
                    Step::new("Check import boundary")
                        .run("bun run --filter @macro-inc/bots check:boundary"),
                )
                .add_step(Step::new("Typecheck").run("bun run --filter @macro-inc/bots type-check"))
                .add_step(Step::new("Lint").run("bun run --filter @macro-inc/bots lint"))
                .add_step(Step::new("Test").run("bun run --filter @macro-inc/bots test"))
                .add_step(Step::new("Build").run("bun run --filter @macro-inc/bots build")),
        )
}
