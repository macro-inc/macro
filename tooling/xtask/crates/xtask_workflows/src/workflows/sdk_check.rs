use gh_workflow::{Concurrency, Event, Expression, Job, PullRequest, Push, Run, Step, Workflow};

use crate::workflows::{runners, steps, vars};

#[cfg(test)]
mod test;

/// Build the workflow.
pub fn sdk_check() -> Workflow {
    Workflow::new("SDK Check")
        .on(Event::default()
            .pull_request(
                PullRequest::default()
                    .add_branch("main")
                    .add_path("packages/sdk/**")
                    .add_path("crates/**/*.rs")
                    .add_path("Cargo.toml")
                    .add_path("Cargo.lock")
                    .add_path("apps/web/scripts/generate-api-schema.ts")
                    .add_path("apps/web/scripts/services.ts")
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
        .add_job("check-sdk", check_sdk())
}

/// Typecheck, test, and coverage-check the package as committed. Needs nothing
/// but Bun, so it stays a cheap gate that can run on every SDK change — unlike
/// [`check_sdk`], which rebuilds the specs from Rust.
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

/// Regenerate the SDK's generated layer end-to-end and fail on drift. Only
/// pull requests pay for this: it rebuilds the specs from Rust, and it shares
/// the web CI cache volume so that build hits the same sccache as the web app
/// checks.
fn check_sdk() -> Job {
    Job::default()
        .name("SDK Generated Code Check")
        .cond(Expression::new(
            "${{ github.event_name == 'pull_request' }}",
        ))
        .runs_on(runners::Runner::Mid.with_cache_tag(vars::WEB_CI_CACHE_TAG))
        .add_step(steps::checkout(false, false))
        .add_step(steps::mount_web_cache_volume(true))
        .add_step(steps::setup_nix())
        .add_step(steps::setup_reqs_web("Setup Prereqs", false))
        .add_step(steps::configure_namespace_sccache(vars::WEB_SCCACHE_NAME))
        .add_step(update_generated())
        .add_step(steps::show_sccache_stats())
        .add_step(verify_fresh())
        .add_step(steps::teardown_nix())
}

fn update_generated() -> Step<Run> {
    Step::new("Regenerate SDK code")
        .run("just update-generated")
        .working_directory("packages/sdk")
}

fn verify_fresh() -> Step<Run> {
    Step::new("Verify generated code is fresh").run(indoc::indoc! {r#"
        if [ -n "$(git status --porcelain -- packages/sdk)" ]; then
          echo "packages/sdk generated code is stale. Run 'just update-generated' in packages/sdk and commit the result."
          git status --porcelain -- packages/sdk
          git diff -- packages/sdk | head -200
          exit 1
        fi
    "#})
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
