//! `TypeScript code check` — biome + tsc for TS packages and services that
//! Web App Pr Checks and SDK Check do not cover.
//! Generated into `code_check_typescript.yml`.

use gh_workflow::{
    Concurrency, Event, Expression, Job, PullRequest, PullRequestType, Run, Step, Use, Workflow,
};

use crate::workflows::{
    runners,
    steps::{self, FluentBuilder},
    vars,
};

/// Same cache volume as the web / infra TS checks (Nix + bun).
fn ts_runner() -> String {
    runners::Runner::Small.with_cache_tag(vars::WEB_CI_CACHE_TAG)
}

/// Build the workflow.
pub fn code_check_typescript() -> Workflow {
    Workflow::new("typescript code check")
        .on(Event::default().pull_request(
            PullRequest::default()
                .add_branch("main")
                .add_type(PullRequestType::Opened)
                .add_type(PullRequestType::Synchronize)
                .add_type(PullRequestType::Reopened)
                .add_type(PullRequestType::ReadyForReview),
        ))
        .concurrency(
            Concurrency::new(Expression::new("code-check-typescript-${{ github.ref }}"))
                .cancel_in_progress(true),
        )
        .add_job("path-check", path_check())
        .add_job("biome-check", biome_check())
        .add_job("typescript", typescript())
        .add_job("status-check", status_check())
}

fn path_check() -> Job {
    Job::default()
        .runs_on(runners::Runner::Small.to_string())
        .add_output("should_run", "${{ steps.filter.outputs.should_run }}")
        .add_step(checkout(false))
        .add_step(paths_filter())
}

fn biome_check() -> Job {
    steps::gated_job()
        .name("Biome Check")
        .runs_on(ts_runner())
        .add_step(checkout(false))
        .add_step(steps::mount_nix_cache_volume())
        .add_step(steps::setup_nix())
        .add_step(steps::setup_dev_shell())
        .add_step(run_script("--biome"))
        .add_step(steps::teardown_nix())
}

fn typescript() -> Job {
    steps::gated_job()
        .name("Typecheck")
        .runs_on(ts_runner())
        .add_step(checkout(false))
        .add_step(steps::mount_web_cache_volume(false))
        .add_step(steps::setup_nix())
        .add_step(steps::setup_reqs_web("Setup Prereqs", false))
        .add_step(install_local(
            "Install CLA worker dependencies",
            xtask_paths::repo_dir!("services/cla-worker"),
        ))
        .add_step(install_local(
            "Install analytics-proxy dependencies",
            xtask_paths::repo_dir!("services/analytics-proxy"),
        ))
        .add_step(install_local(
            "Install websocket-service dependencies",
            xtask_paths::repo_dir!("services/websocket-service"),
        ))
        .add_step(run_script("--tsc"))
        .add_step(steps::teardown_nix())
}

/// Always-run collector used as the required status check.
fn status_check() -> Job {
    Job::default()
        .name("TypeScript Status Check")
        .cond(Expression::new("always()"))
        .needs(vec![
            "path-check".to_string(),
            "biome-check".to_string(),
            "typescript".to_string(),
        ])
        .runs_on(runners::Runner::Small.to_string())
        .add_step(check_job_results())
}

fn checkout(full_history: bool) -> Step<Use> {
    Step::new("Checkout Repo")
        .uses(
            "actions",
            "checkout",
            "df4cb1c069e1874edd31b4311f1884172cec0e10",
        ) // v6
        .when(full_history, |step| step.add_with(("fetch-depth", 0)))
}

fn paths_filter() -> Step<Use> {
    Step::new("Filter changed paths")
        .uses(
            "dorny",
            "paths-filter",
            "d1c1ffe0248fe513906c8e24db8ea791d46f8590",
        ) // v3.0.3
        .id("filter")
        .add_with((
            "filters",
            indoc::indoc! {r#"
                should_run:
                  - 'biome.base.jsonc'
                  - 'package.json'
                  - 'bun.lock'
                  - 'packages/lexical-core/**'
                  - 'packages/loro-mirror/**'
                  - 'packages/observability/**'
                  - 'packages/email-renderer/**'
                  - 'services/ai-editing-worker/**'
                  - 'services/lexical-service/**'
                  - 'services/cla-worker/**'
                  - 'services/analytics-proxy/**'
                  - 'services/websocket-service/**'
                  - 'services/coding-agent-worker/**'
                  - 'services/bots/**'
                  - 'tooling/scripts/check-typescript.sh'
                  - 'flake.nix'
                  - 'flake.lock'
                  - '.github/actions/setup-nix-dev-shell/**'
                  - '.github/actions/teardown-nix/**'
                  - '.github/actions/setup-reqs-web/**'
                  - '.github/workflows/code_check_typescript.yml'
            "#},
        ))
}

fn run_script(args: &str) -> Step<Run> {
    Step::new(format!("Run TypeScript checks ({args})"))
        .run(format!("bash tooling/scripts/check-typescript.sh {args}"))
}

fn install_local(name: &str, dir: xtask_paths::RepoDir<'static>) -> Step<Run> {
    Step::new(name)
        .run("bun install --frozen-lockfile")
        .working_directory(dir)
}

fn check_job_results() -> Step<Run> {
    Step::new("Check job results").run(indoc::indoc! {r#"
        echo "path-check: ${{ needs.path-check.result }}"
        echo "biome-check: ${{ needs.biome-check.result }}"
        echo "typescript: ${{ needs.typescript.result }}"

        # Fail if any job failed (skipped and success are both OK)
        if [[ "${{ needs.path-check.result }}" == "failure" ]] || \
           [[ "${{ needs.biome-check.result }}" == "failure" ]] || \
           [[ "${{ needs.typescript.result }}" == "failure" ]]; then
          echo "One or more jobs failed"
          exit 1
        fi

        echo "All jobs passed or were skipped"
    "#})
}

#[cfg(test)]
mod test;
