use gh_workflow::{Concurrency, Event, Expression, Job, PullRequest, Run, Step, Workflow};

use crate::workflows::{runners, steps, vars};

/// Build the workflow.
pub fn sdk_check() -> Workflow {
    Workflow::new("SDK Check")
        .on(Event::default().pull_request(
            PullRequest::default()
                .add_branch("main")
                .add_path("packages/sdk/**")
                .add_path("crates/**/*.rs")
                .add_path("Cargo.toml")
                .add_path("Cargo.lock")
                .add_path("apps/web/scripts/generate-api-schema.ts")
                .add_path("apps/web/scripts/services.ts")
                .add_path(".github/workflows/sdk-check.yml"),
        ))
        .concurrency(
            Concurrency::new(Expression::new(
                "${{ github.workflow }}-${{ github.ref }}-check",
            ))
            .cancel_in_progress(true),
        )
        .add_job("check-sdk", check_sdk())
}

/// Regenerate the SDK's generated layer end-to-end and fail on drift, then
/// typecheck. Shares the web CI cache volume so the gen-api Rust build hits
/// the same sccache as the web app checks.
fn check_sdk() -> Job {
    Job::default()
        .name("SDK Generated Code Check")
        .runs_on(runners::Runner::Mid.with_cache_tag(vars::WEB_CI_CACHE_TAG))
        .add_step(steps::checkout(false, false))
        .add_step(steps::mount_web_cache_volume(true))
        .add_step(steps::setup_nix())
        .add_step(steps::setup_reqs_web("Setup Prereqs", false))
        .add_step(steps::configure_namespace_sccache(vars::WEB_SCCACHE_NAME))
        .add_step(update_generated())
        .add_step(steps::show_sccache_stats())
        .add_step(verify_fresh())
        .add_step(typecheck())
        .add_step(check_coverage())
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

fn typecheck() -> Step<Run> {
    Step::new("Typecheck SDK")
        .run("bun run check")
        .working_directory("packages/sdk")
}
