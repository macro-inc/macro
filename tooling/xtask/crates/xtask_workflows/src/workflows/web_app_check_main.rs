//! `Web App Pr Checks` — frontend PR checks for the web app.
//! Generated into `web-app-check-main.yml`.

use gh_workflow::{
    Concurrency, Event, Expression, Job, PullRequest, PullRequestType, Run, Step, Use, Workflow,
};

use crate::workflows::{
    runners,
    steps::{self, FluentBuilder},
    vars,
};

#[cfg(test)]
mod test;

/// Frontend-only jobs share one small Namespace profile with a dedicated cache
/// tag, so their Nix/Bun state lives on its own volume.
fn web_runner() -> String {
    runners::Runner::Small.with_cache_tag(vars::WEB_CI_CACHE_TAG)
}

/// Typechecking can compile the Rust binaries used by `gen-api`, so retain the
/// mid-size profile while sharing the web CI cache volume and remote sccache.
fn typecheck_runner() -> String {
    runners::Runner::Mid.with_cache_tag(vars::WEB_CI_CACHE_TAG)
}

/// Build the workflow.
pub fn web_app_check_main() -> Workflow {
    Workflow::new("Web App Pr Checks")
        .on(Event::default().pull_request(
            PullRequest::default()
                .add_branch("main")
                .add_type(PullRequestType::Opened)
                .add_type(PullRequestType::Synchronize)
                .add_type(PullRequestType::Reopened)
                .add_type(PullRequestType::ReadyForReview),
        ))
        .concurrency(
            Concurrency::new(Expression::new(
                "${{ github.workflow }}-${{ github.ref }}-check",
            ))
            .cancel_in_progress(true),
        )
        .add_job("path-check", path_check())
        .add_job("typescript", typescript())
        .add_job("biome-check", biome_check())
        .add_job("tailwind", tailwind())
        .add_job("test", test())
        .add_job("cycles", cycles())
        .add_job("build", build())
        .add_job("status-check", status_check())
}

fn path_check() -> Job {
    Job::default()
        .runs_on(runners::Runner::TinyNoCache.to_string())
        .add_output("should_run", "${{ steps.filter.outputs.should_run }}")
        .add_output("api_changed", "${{ steps.filter.outputs.api_changed }}")
        .add_step(checkout("Checkout Repo", false))
        .add_step(paths_filter())
}

fn typescript() -> Job {
    Job::default()
        .needs(vec!["path-check".to_string()])
        .cond(Expression::new(
            "needs.path-check.outputs.should_run == 'true' || needs.path-check.outputs.api_changed == 'true'",
        ))
        .name("Typecheck")
        .runs_on(typecheck_runner())
        .add_step(checkout("Checkout Repo", false))
        .add_step(steps::mount_web_cache_volume(true))
        .add_step(steps::setup_nix())
        .add_step(steps::setup_reqs_web("Setup Prereqs", false))
        .add_step(steps::configure_namespace_sccache_when(
            vars::WEB_SCCACHE_NAME,
            "needs.path-check.outputs.api_changed == 'true'",
        ))
        .add_step(generate_api_types())
        .add_step(show_sccache_stats())
        .add_step(check_types())
        .add_step(check_collaboration_types())
        .add_step(steps::teardown_nix())
}

fn biome_check() -> Job {
    gated_web_job("Biome Check")
        .add_step(checkout("Checkout Repo", true))
        .add_step(steps::mount_nix_cache_volume())
        .add_step(steps::setup_nix())
        .add_step(steps::setup_dev_shell())
        .add_step(run_biome())
        .add_step(run_collaboration_biome())
        .add_step(steps::teardown_nix())
}

fn tailwind() -> Job {
    gated_web_job("Theme Hygiene Inspector")
        .add_step(checkout("Checkout Repo", true))
        .add_step(steps::mount_web_cache_volume(false))
        .add_step(steps::setup_nix())
        .add_step(steps::setup_reqs_web("Setup Prereqs", false))
        .add_step(check_tailwind_classes())
        .add_step(steps::teardown_nix())
}

fn test() -> Job {
    gated_web_job("Test")
        .add_step(checkout("Checkout Repo", false))
        .add_step(steps::mount_web_cache_volume(false))
        .add_step(steps::setup_nix())
        .add_step(steps::setup_reqs_web("Setup", true))
        .add_step(run_tests())
        .add_step(steps::teardown_nix())
}

fn cycles() -> Job {
    gated_web_job("Cycles Import Check")
        .add_step(checkout("Checkout", false))
        .add_step(steps::mount_nix_cache_volume())
        .add_step(steps::setup_nix())
        .add_step(steps::setup_dev_shell())
        .add_step(cycles_import_check())
        .add_step(collaboration_cycles_import_check())
        .add_step(steps::teardown_nix())
}

fn build() -> Job {
    gated_web_job("Build")
        .add_step(checkout("Checkout Repo", false))
        .add_step(steps::mount_web_cache_volume(false))
        .add_step(steps::setup_nix())
        .add_step(steps::setup_reqs_web("Setup", false))
        .add_step(run_build())
        .add_step(steps::teardown_nix())
}

/// Always-run collector used as the required status check. Its name must stay
/// stable because branch protection can reference it.
fn status_check() -> Job {
    Job::default()
        .name("Web App Status Check")
        .cond(Expression::new("always()"))
        .needs(vec![
            "path-check".to_string(),
            "typescript".to_string(),
            "biome-check".to_string(),
            "tailwind".to_string(),
            "test".to_string(),
            "cycles".to_string(),
            "build".to_string(),
        ])
        .runs_on(runners::Runner::TinyNoCache.to_string())
        .add_step(check_job_results())
}

fn gated_web_job(name: &str) -> Job {
    Job::default()
        .needs(vec!["path-check".to_string()])
        .cond(Expression::new(
            "needs.path-check.outputs.should_run == 'true'",
        ))
        .name(name)
        .runs_on(web_runner())
}

fn checkout(name: &str, full_history: bool) -> Step<Use> {
    Step::new(name)
        .uses(
            "actions",
            "checkout",
            "df4cb1c069e1874edd31b4311f1884172cec0e10",
        ) // v6
        .when(full_history, |step| step.add_with(("fetch-depth", 0)))
}

fn paths_filter() -> Step<Use> {
    let artifact_paths = crate::workflows::web_artifact_paths::yaml_list("  ");

    // `api_changed` is only the inputs to `bun run gen-api`. xtask, flake.nix,
    // the Nix dev-shell action, and this workflow file do not change OpenAPI
    // output, so they must not start Typecheck (which compiles the schema
    // binaries). The Nix dev-shell action is also omitted from `should_run`
    // so Typecheck (which is `should_run || api_changed`) stays off for a
    // shell-only tweak. Workflow YAML drift is `check generated workflows`.
    Step::new("Filter changed paths")
        .uses(
            "dorny",
            "paths-filter",
            "d1c1ffe0248fe513906c8e24db8ea791d46f8590",
        ) // v3.0.3
        .id("filter")
        .add_with((
            "filters",
            format!(
                "should_run:\n{artifact_paths}  - 'services/lexical-service/**'\n  - '.github/actions/setup-reqs-web/**'\napi_changed:\n  - 'crates/**/*.rs'\n  - 'services/**/*.rs'\n  - 'Cargo.toml'\n  - 'Cargo.lock'\n  - 'apps/web/scripts/generate-api-schema.ts'\n  - 'apps/web/scripts/services.ts'\n  - '.github/actions/setup-reqs-web/**'\n"
            ),
        ))
}

fn generate_api_types() -> Step<Run> {
    Step::new("Generate API Types")
        .run("bun run gen-api -- --check")
        .if_condition(Expression::new(
            "needs.path-check.outputs.api_changed == 'true'",
        ))
        .working_directory(xtask_paths::repo_dir!("apps/web"))
}

fn show_sccache_stats() -> Step<Run> {
    Step::new("show sccache stats")
        .run("sccache --show-stats || true")
        .if_condition(Expression::new(
            "always() && needs.path-check.outputs.api_changed == 'true'",
        ))
}

fn check_types() -> Step<Run> {
    Step::new("Check Types")
        .run("bun run --bun --silent tsc --project ./tsconfig.json")
        .working_directory(xtask_paths::repo_dir!("apps/web"))
}

fn check_collaboration_types() -> Step<Run> {
    Step::new("Check Collaboration Package Types")
        .run("bun run type-check")
        .working_directory(xtask_paths::repo_dir!("packages/collaboration"))
}

fn run_biome() -> Step<Run> {
    Step::new("Run Biome")
        .run("biome ci --changed --no-errors-on-unmatched --error-on-warnings")
        .working_directory(xtask_paths::repo_dir!("apps/web"))
}

fn run_collaboration_biome() -> Step<Run> {
    Step::new("Run Collaboration Package Biome")
        .run("biome ci --changed --no-errors-on-unmatched --error-on-warnings")
        .working_directory(xtask_paths::repo_dir!("packages/collaboration"))
}

fn check_tailwind_classes() -> Step<Run> {
    Step::new("Check Tailwind Classes")
        .run("just check-tailwind")
        .working_directory(xtask_paths::repo_dir!("apps/web"))
}

fn run_tests() -> Step<Run> {
    Step::new("Test")
        .run("bunx vitest")
        .working_directory(xtask_paths::repo_dir!("apps/web"))
}

fn cycles_import_check() -> Step<Run> {
    Step::new("Cycles Import Check")
        .run("biome lint --changed --no-errors-on-unmatched --only=suspicious/noImportCycles")
        .working_directory(xtask_paths::repo_dir!("apps/web"))
}

fn collaboration_cycles_import_check() -> Step<Run> {
    Step::new("Collaboration Package Cycles Import Check")
        .run("biome lint --changed --no-errors-on-unmatched --only=suspicious/noImportCycles")
        .working_directory(xtask_paths::repo_dir!("packages/collaboration"))
}

fn run_build() -> Step<Run> {
    Step::new("Build")
        .run("just build-dev")
        .working_directory(xtask_paths::repo_dir!("apps/web"))
}

fn check_job_results() -> Step<Run> {
    Step::new("Check job results").run(indoc::indoc! {r#"
        echo "path-check: ${{ needs.path-check.result }}"
        echo "typescript: ${{ needs.typescript.result }}"
        echo "biome-check: ${{ needs.biome-check.result }}"
        echo "tailwind: ${{ needs.tailwind.result }}"
        echo "test: ${{ needs.test.result }}"
        echo "cycles: ${{ needs.cycles.result }}"
        echo "build: ${{ needs.build.result }}"

        # Fail if any job failed (skipped and success are both OK)
        if [[ "${{ needs.path-check.result }}" == "failure" ]] || \
           [[ "${{ needs.typescript.result }}" == "failure" ]] || \
           [[ "${{ needs.biome-check.result }}" == "failure" ]] || \
           [[ "${{ needs.tailwind.result }}" == "failure" ]] || \
           [[ "${{ needs.test.result }}" == "failure" ]] || \
           [[ "${{ needs.cycles.result }}" == "failure" ]] || \
           [[ "${{ needs.build.result }}" == "failure" ]]; then
          echo "One or more jobs failed"
          exit 1
        fi

        echo "All jobs passed or were skipped"
    "#})
}
