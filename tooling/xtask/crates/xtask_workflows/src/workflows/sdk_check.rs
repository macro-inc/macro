use gh_workflow::{Event, Job, Push, Run, Step, Workflow, WorkflowCall};
use xtask_paths::RepoGlob;

use crate::workflows::actions::ActionsSetupNode;
use crate::workflows::{attestation, steps, vars};

#[cfg(test)]
mod test;

/// Files whose change makes `PR CI` call this workflow, and that runs it on `main`.
pub const PATHS: &[RepoGlob<'static>] = &[
    xtask_paths::repo_glob!("packages/sdk/**"),
    // The SDK resolves its dependencies from the root workspace lockfile.
    xtask_paths::repo_glob!("bun.lock"),
    xtask_paths::repo_glob!(".github/workflows/sdk-check.yml"),
];

/// Build the workflow. Whether `packages/sdk`'s generated layer is fresh is
/// checked by the web app workflow's `Generated Code Check`, which builds the
/// spec binaries once for every Rust-generated artifact.
pub fn sdk_check() -> Workflow {
    Workflow::new("SDK Check")
        .on(Event::default()
            // Guard SDK changes with the same validation used before publishing.
            .push(
                PATHS
                    .iter()
                    .fold(Push::default().add_branch("main"), |trigger, path| {
                        trigger.add_path(*path)
                    }),
            )
            .workflow_call(attestation::takes_attestations(WorkflowCall::default())))
        .concurrency(vars::concurrency("sdk-check"))
        .add_job("check-package", check_package())
}

/// Typecheck, test, and coverage-check the package as committed. Needs nothing
/// but Bun and Node, including isolated consumers of the packed SDK.
fn check_package() -> Job {
    Job::default()
        .cond(attestation::not_attested("sdk/check-package"))
        .timeout_minutes(10u32)
        .name("SDK Package Check")
        .runs_on("ubuntu-latest")
        .add_step(steps::checkout(false, false))
        .add_step(steps::setup_bun_action().bun_version(steps::SDK_BUN_VERSION))
        .add_step(ActionsSetupNode::new("Setup Node").node_version("24"))
        .add_step(install_dependencies())
        .add_step(typecheck())
        .add_step(run_tests())
        .add_step(check_coverage())
        .add_step(
            Step::new("Check packed SDK")
                .run("bun run build && bun run check:pack")
                .working_directory(xtask_paths::repo_dir!("packages/sdk")),
        )
}

fn install_dependencies() -> Step<Run> {
    Step::new("Install dependencies")
        .run("bun install --frozen-lockfile")
        .working_directory(xtask_paths::repo_dir!("packages/sdk"))
}

/// Every generated endpoint must either have a call site under `src/` or be
/// hand-listed in `src/coverage/skipped.ts`; fails naming the offenders.
fn check_coverage() -> Step<Run> {
    Step::new("Check endpoint coverage")
        .run("bun run coverage")
        .working_directory("packages/sdk")
}

/// The release publishes on merge, so this gate runs the same suite the release
/// validates rather than discovering a failure after it has landed.
fn run_tests() -> Step<Run> {
    Step::new("Test SDK")
        .run("bun test")
        .working_directory(xtask_paths::repo_dir!("packages/sdk"))
}

fn typecheck() -> Step<Run> {
    Step::new("Typecheck SDK")
        .run("bun run check")
        .working_directory("packages/sdk")
}
