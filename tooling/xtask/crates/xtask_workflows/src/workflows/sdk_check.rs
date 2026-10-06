use gh_workflow::{Concurrency, Event, Expression, Job, PullRequest, Push, Run, Step, Workflow};

use crate::workflows::steps;

#[cfg(test)]
mod test;

/// Build the workflow. Whether `packages/sdk`'s generated layer is fresh is
/// checked by the web app workflow's `Generated Code Check`, which builds the
/// spec binaries once for every Rust-generated artifact.
pub fn sdk_check() -> Workflow {
    Workflow::new("SDK Check")
        .on(Event::default()
            .pull_request(
                PullRequest::default()
                    .add_branch("main")
                    .add_path("packages/sdk/**")
                    .add_path(".github/workflows/sdk-check.yml"),
            )
            // `Release SDK` publishes from `main` without re-checking the
            // package, so the same suite has to guard what lands there.
            .push(
                Push::default()
                    .add_branch("main")
                    .add_path("packages/sdk/**")
                    .add_path(".github/workflows/sdk-check.yml"),
            ))
        .concurrency(
            Concurrency::new(Expression::new(
                "${{ github.workflow }}-${{ github.ref }}-check",
            ))
            .cancel_in_progress(true),
        )
        .add_job("check-package", check_package())
}

/// Typecheck, test, and coverage-check the package as committed. Needs nothing
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
