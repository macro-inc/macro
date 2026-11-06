use gh_workflow::{Event, Job, Push, Run, Step, Workflow, WorkflowCall};
use xtask_paths::RepoGlob;

use crate::workflows::{steps, vars};

#[cfg(test)]
mod test;

/// Validates `@macro-inc/sdk-calls`; shared with its release workflows.
pub const CALLS_VALIDATION: &str =
    "bun run check && bun test && bun run build && bun run check:pack";

/// Files whose change makes `PR CI` call this workflow, and that runs it on `main`.
pub const PATHS: &[RepoGlob<'static>] = &[
    xtask_paths::repo_glob!("packages/sdk/**"),
    xtask_paths::repo_glob!("packages/sdk-calls/**"),
    xtask_paths::repo_glob!(".github/workflows/sdk-check.yml"),
];

/// Build the workflow. Whether `packages/sdk`'s generated layer is fresh is
/// checked by the web app workflow's `Generated Code Check`, which builds the
/// spec binaries once for every Rust-generated artifact.
pub fn sdk_check() -> Workflow {
    Workflow::new("SDK Check")
        .on(Event::default()
            // `Release SDK` publishes from `main` without re-checking the
            // package, so the same suite has to guard what lands there.
            .push(
                PATHS
                    .iter()
                    .fold(Push::default().add_branch("main"), |trigger, path| {
                        trigger.add_path(*path)
                    }),
            )
            .workflow_call(WorkflowCall::default()))
        .concurrency(vars::concurrency("sdk-check"))
        .add_job("check-package", check_package())
}

/// Typecheck, test, and coverage-check the packages as committed. Needs nothing
/// but Bun, so it stays a cheap gate that can run on every SDK change.
fn check_package() -> Job {
    Job::default()
        .name("SDK Package Check")
        .runs_on("ubuntu-latest")
        .add_step(steps::checkout(false, false))
        .add_step(steps::setup_bun().add_with(("bun-version", "1.3.5")))
        .add_step(install_dependencies())
        .add_step(typecheck())
        .add_step(run_tests())
        .add_step(check_coverage())
        .add_step(build_sdk())
        .add_step(install_calls_dependencies())
        .add_step(check_calls())
}

/// `@macro-inc/sdk-calls` compiles against the SDK's built declarations.
fn build_sdk() -> Step<Run> {
    Step::new("Build SDK")
        .run("bun run build")
        .working_directory(xtask_paths::repo_dir!("packages/sdk"))
}

fn install_calls_dependencies() -> Step<Run> {
    Step::new("Install sdk-calls dependencies")
        .run("bun install --frozen-lockfile")
        .working_directory(xtask_paths::repo_dir!("packages/sdk-calls"))
}

/// The same suite the release validates, including what the tarball would hold.
fn check_calls() -> Step<Run> {
    Step::new("Check sdk-calls")
        .run(CALLS_VALIDATION)
        .working_directory(xtask_paths::repo_dir!("packages/sdk-calls"))
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
