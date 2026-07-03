//! `Web App Pr Checks` — frontend PR checks for the web app.
//! Generated into `web-app-check-main.yml`.

use gh_workflow::{
    Concurrency, Env, Event, Expression, Job, PullRequest, PullRequestType, Run, Step, Use,
    Workflow,
};

use crate::workflows::{
    runners,
    steps::{self, FluentBuilder},
    vars,
};

const WEB_TYPESCRIPT_RUNNER: &str = "linux-extra-beefy";
const WEB_DEFAULT_RUNNER: &str = "linux-latest-middy";
const SCCACHE_BUCKET: &str = "${{ vars.SCCACHE_BUCKET || secrets.SCCACHE_BUCKET }}";
const AWS_ACCESS_KEY_ID: &str = "${{ secrets.AWS_ACCESS_KEY_ID || secrets.AWS_ACCESS_KEY }}";
const AWS_SECRET_ACCESS_KEY: &str = "${{ secrets.AWS_SECRET_ACCESS_KEY }}";

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
        .runs_on(runners::Runner::Small.to_string())
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
        .runs_on(WEB_TYPESCRIPT_RUNNER)
        .add_step(checkout("Checkout Repo", false))
        .add_step(setup_reqs_web("Setup Prereqs", false))
        .add_step(rust_cache())
        .add_step(generate_api_types())
        .add_step(show_sccache_stats())
        .add_step(check_types())
}

fn biome_check() -> Job {
    gated_web_job("Biome Check")
        .add_step(checkout("Checkout Repo", true))
        .add_step(setup_cachix_dev_shell())
        .add_step(run_biome())
}

fn tailwind() -> Job {
    gated_web_job("Theme Hygiene Inspector")
        .add_step(checkout("Checkout Repo", true))
        .add_step(setup_reqs_web("Setup Prereqs", false))
        .add_step(check_tailwind_classes())
}

fn test() -> Job {
    gated_web_job("Test")
        .add_step(checkout("Checkout Repo", false))
        .add_step(setup_reqs_web("Setup", true))
        .add_step(run_tests())
}

fn cycles() -> Job {
    gated_web_job("Cycles Import Check")
        .add_step(checkout("Checkout", false))
        .add_step(setup_cachix_dev_shell())
        .add_step(cycles_import_check())
}

fn build() -> Job {
    gated_web_job("Build")
        .add_step(checkout("Checkout Repo", false))
        .add_step(setup_reqs_web("Setup", false))
        .add_step(run_build())
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
        .runs_on(runners::Runner::Small.to_string())
        .add_step(check_job_results())
}

fn gated_web_job(name: &str) -> Job {
    Job::default()
        .needs(vec!["path-check".to_string()])
        .cond(Expression::new(
            "needs.path-check.outputs.should_run == 'true'",
        ))
        .name(name)
        .runs_on(WEB_DEFAULT_RUNNER)
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
                  - 'js/package.json'
                  - 'js/bun.lock'
                  - 'js/app/package.json'
                  - 'js/app/packages/**'
                  - 'js/app/src/**'
                  - 'js/app/biome.jsonc'
                  - 'js/lexical-core/**'
                  - 'js/lexical-service/**'
                  - '.github/actions/setup-cachix/**'
                  - '.github/actions/setup-reqs-web/**'
                  - '.github/workflows/web-app-check-main.yml'
                api_changed:
                  - 'rust/cloud-storage/**/*.rs'
                  - 'rust/cloud-storage/Cargo.toml'
                  - 'rust/cloud-storage/Cargo.lock'
                  - 'flake.nix'
                  - 'flake.lock'
                  - 'js/app/scripts/generate-api-schema.ts'
                  - 'js/app/scripts/services.ts'
                  - '.github/actions/setup-cachix/**'
                  - '.github/actions/setup-reqs-web/**'
                  - '.github/workflows/web-app-check-main.yml'
            "#},
        ))
}

fn setup_reqs_web(name: &str, playwright: bool) -> Step<Use> {
    steps::uses_local(name, "./.github/actions/setup-reqs-web")
        .add_with(("cachix-auth-token", vars::CACHIX_AUTH_TOKEN))
        .add_with(("sccache-bucket", SCCACHE_BUCKET))
        .when(playwright, |step| step.add_with(("playwright", "true")))
}

fn setup_cachix_dev_shell() -> Step<Use> {
    steps::uses_local("Setup Nix dev shell", "./.github/actions/setup-cachix")
        .add_with(("cachix-auth-token", vars::CACHIX_AUTH_TOKEN))
        .add_with(("dev-shell", "true"))
        .add_with(("sccache-bucket", SCCACHE_BUCKET))
}

fn rust_cache() -> Step<Use> {
    Step::new("Cache Rust")
        .uses(
            "Swatinem",
            "rust-cache",
            "9d47c6ad4b02e050fd481d890b2ea34778fd09d6",
        )
        .if_condition(Expression::new(
            "needs.path-check.outputs.api_changed == 'true'",
        ))
        .add_with(("workspaces", "rust/cloud-storage"))
        .add_with(("shared-key", "cloud-storage-gen-api"))
        .add_with(("cache-on-failure", "true"))
        .add_with(("cache-targets", "true"))
}

fn generate_api_types() -> Step<Run> {
    with_aws_env(
        Step::new("Generate API Types")
            .run("bun run gen-api -- --check")
            .if_condition(Expression::new(
                "needs.path-check.outputs.api_changed == 'true'",
            ))
            .working_directory("js/app"),
    )
}

fn show_sccache_stats() -> Step<Run> {
    with_aws_env(
        Step::new("show sccache stats")
            .run("sccache --show-stats || true")
            .if_condition(Expression::new(
                "always() && needs.path-check.outputs.api_changed == 'true'",
            )),
    )
}

fn with_aws_env(step: Step<Run>) -> Step<Run> {
    step.add_env(Env::new("AWS_ACCESS_KEY_ID", AWS_ACCESS_KEY_ID))
        .add_env(Env::new("AWS_SECRET_ACCESS_KEY", AWS_SECRET_ACCESS_KEY))
}

fn check_types() -> Step<Run> {
    Step::new("Check Types")
        .run("bun run --bun --silent tsc --project ./packages/app/tsconfig.json")
        .working_directory("js/app")
}

fn run_biome() -> Step<Run> {
    Step::new("Run Biome")
        .run("biome ci --changed --no-errors-on-unmatched --error-on-warnings")
        .working_directory("js/app")
}

fn check_tailwind_classes() -> Step<Run> {
    Step::new("Check Tailwind Classes")
        .run("just check-tailwind")
        .working_directory("js/app")
}

fn run_tests() -> Step<Run> {
    Step::new("Test")
        .run("bunx vitest")
        .working_directory("js/app")
}

fn cycles_import_check() -> Step<Run> {
    Step::new("Cycles Import Check")
        .run("biome lint --changed --no-errors-on-unmatched --only=suspicious/noImportCycles")
        .working_directory("js/app")
}

fn run_build() -> Step<Run> {
    Step::new("Build")
        .run("bun run build")
        .working_directory("js/app")
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
