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

/// The generated-code job compiles the schema binaries and the app build
/// compiles the two browser wasm packages, so both keep the mid-size profile
/// while sharing the web CI cache volume and remote sccache. Typecheck no
/// longer compiles Rust but stays on mid: `tsc` over the whole app has not been
/// measured on the small profile.
fn mid_web_runner() -> String {
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
        .add_job("generated-code", generated_code())
        .add_job("biome-check", biome_check())
        .add_job("test", test())
        .add_job("cycles", cycles())
        .add_job("build", build())
        .add_job("status-check", status_check())
}

fn path_check() -> Job {
    Job::default()
        .runs_on(runners::Runner::TinyNoCache.to_string())
        .add_output("should_run", "${{ steps.filter.outputs.should_run }}")
        .add_output(
            "codegen_changed",
            "${{ steps.filter.outputs.codegen_changed }}",
        )
        .add_step(checkout("Checkout Repo", false))
        .add_step(paths_filter())
}

/// TypeScript checks against the committed generated code. Whether that code
/// is fresh is [`generated_code`]'s job, so a Rust-only change does not start
/// this one.
fn typescript() -> Job {
    Job::default()
        .needs(vec!["path-check".to_string()])
        .cond(Expression::new(
            "needs.path-check.outputs.should_run == 'true'",
        ))
        .name("Typecheck")
        .runs_on(mid_web_runner())
        .add_step(checkout("Checkout Repo", false))
        .add_step(steps::mount_web_cache_volume(false))
        .add_step(steps::setup_nix())
        .add_step(steps::setup_reqs_web("Setup Prereqs", false))
        .add_step(check_dynamic_ui_schema())
        .add_step(check_types())
        .add_step(check_collaboration_types())
        .add_step(check_lexical_service_types())
        .add_step(test_lexical_service())
        .add_step(steps::teardown_nix())
}

/// Everything generated from Rust binaries: the OpenAPI clients in `apps/web`
/// (`gen-api`), the specta wasm wire types, the SDK's specs and generated
/// layer, and the MCP tool reference in `apps/docs`. They used to be checked by
/// three jobs in three workflows, each compiling the workspace again; one job
/// on one target dir builds the binaries once. The SDK regeneration reuses the
/// specs `gen-api` just wrote rather than rerunning it.
fn generated_code() -> Job {
    Job::default()
        .needs(vec!["path-check".to_string()])
        .cond(Expression::new(
            "needs.path-check.outputs.codegen_changed == 'true'",
        ))
        .name("Generated Code Check")
        .runs_on(mid_web_runner())
        // The generators run once and are thrown away, so debug info is pure
        // cost: it made the 15 binaries 12.7 GB instead of 466 MB. Job-level,
        // so every cargo call here (the build step, gen-api, the docs and DCS
        // scripts, the specta recipes) resolves the same profile and reuses
        // one set of artifacts. No `profile.dev.package` overrides exist, so
        // this alone covers dependencies too.
        .add_env(("CARGO_PROFILE_DEV_DEBUG", "0"))
        // Link with mold, as the Rust check and test jobs do. Job-level for
        // the same reason: RUSTFLAGS is part of every unit's fingerprint.
        .add_env(("RUSTFLAGS", "-C link-arg=-fuse-ld=mold"))
        .add_step(checkout("Checkout Repo", false))
        .add_step(steps::mount_web_cache_volume(true))
        .add_step(steps::setup_nix())
        .add_step(steps::setup_reqs_web("Setup Prereqs", false))
        .add_step(steps::configure_namespace_sccache(vars::WEB_SCCACHE_NAME))
        .add_step(build_schema_binaries())
        .add_step(generate_api_types())
        .add_step(regenerate_sdk())
        .add_step(verify_fresh(
            "Verify SDK generated code is fresh",
            "packages/sdk",
            "packages/sdk generated code is stale. Run 'just update-generated' in packages/sdk and commit the result.",
        ))
        .add_step(regenerate_tool_pages())
        .add_step(verify_fresh(
            "Verify docs tool reference is fresh",
            "apps/docs",
            "apps/docs tool reference is stale. Run 'bun run generate:tools' in apps/docs and commit the result.",
        ))
        // Last: its `cargo run -p` builds resolve features per package, so
        // running them earlier would make the steps above recompile.
        .add_step(check_specta_types())
        .add_step(steps::show_sccache_stats())
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

fn test() -> Job {
    gated_web_job("Test")
        .add_step(checkout("Checkout Repo", false))
        .add_step(steps::mount_web_cache_volume(false))
        .add_step(steps::setup_nix())
        .add_step(steps::setup_reqs_web("Setup", true))
        .add_step(run_tests())
        .add_step(run_signup_browser_tests())
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
        // Match preview/deploy capacity for Vite's chunk-rendering memory peak.
        .runs_on(runners::Runner::Mid.with_cache_tag(vars::WEB_CI_CACHE_TAG))
        .add_step(checkout("Checkout Repo", false))
        .add_step(steps::mount_web_build_cache_volume())
        .add_step(steps::setup_nix())
        .add_step(steps::setup_reqs_web("Setup", false))
        .add_step(steps::configure_namespace_sccache(vars::WEB_SCCACHE_NAME))
        .add_step(steps::start_sccache_server())
        .add_step(run_build())
        .add_step(steps::show_sccache_stats())
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
            "generated-code".to_string(),
            "biome-check".to_string(),
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

    // `codegen_changed` is the union of what feeds [`generated_code`]: the
    // Rust sources and manifests the schema binaries compile from, the
    // `gen-api` scripts, and the SDK and docs packages that hold generated
    // output. xtask, flake.nix, the Nix dev-shell action, and this workflow
    // file do not change generated output, so they must not start that job.
    // The Nix dev-shell action is also omitted from `should_run` so Typecheck
    // stays off for a shell-only tweak. Workflow YAML drift is `check
    // generated workflows`.
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
                "should_run:\n{artifact_paths}  - 'services/lexical-service/**'\n  - 'crates/ai_tools/src/display_results/schema.generated.json'\n  - '.github/actions/setup-reqs-web/**'\ncodegen_changed:\n  - 'crates/**/*.rs'\n  - 'services/**/*.rs'\n  - 'Cargo.toml'\n  - 'Cargo.lock'\n  - 'apps/web/scripts/generate-api-schema.ts'\n  - 'apps/web/scripts/services.ts'\n  - 'packages/sdk/**'\n  - 'apps/docs/**'\n  - '.github/actions/setup-reqs-web/**'\n"
            ),
        ))
}

/// Build every schema binary the later steps run in one cargo invocation:
/// the OpenAPI bins (`gen-api` owns the list) and `gen_tool_schemas`, which
/// `gen-api`'s DCS tool types and the docs pages both run. Without
/// `--package`, cargo resolves features across the whole workspace, so the
/// scripts' own `cargo build --bin …` calls resolve the same artifacts and
/// finish without compiling.
fn build_schema_binaries() -> Step<Run> {
    Step::new("Build schema binaries").run(indoc::indoc! {r#"
        set -euo pipefail
        read -ra openapi_bins <<< "$(cd apps/web && bun scripts/generate-api-schema.ts --print-cargo-bins)"
        SQLX_OFFLINE=true cargo build "${openapi_bins[@]}" --bin gen_tool_schemas
    "#})
}

fn generate_api_types() -> Step<Run> {
    Step::new("Generate API Types")
        .run("bun run gen-api -- --check")
        .working_directory(xtask_paths::repo_dir!("apps/web"))
}

/// `gen-api` covers the OpenAPI clients; the types specta writes from the
/// wire types of the two browser wasm crates are regenerated here, so a Rust
/// change cannot leave them behind.
fn check_specta_types() -> Step<Run> {
    Step::new("Check Specta Types")
        .run(indoc::indoc! {r#"
            just gen-agent-fold-types
            just gen-database-sql-types
            if ! git diff --exit-code -- src/lib/service-clients/service-agent-fold/generated src/lib/core/database-sql/generated; then
              echo "Generated wasm wire types are stale. Run 'just gen-agent-fold-types' and 'just gen-database-sql-types' in apps/web and commit the result."
              exit 1
            fi
        "#})
        .working_directory(xtask_paths::repo_dir!("apps/web"))
}

/// The tail of `just update-generated` in `packages/sdk`: its first line reruns
/// `gen-api`, whose specs the step before this one already wrote, so only the
/// copy into `specs/` and the client generation run here.
fn regenerate_sdk() -> Step<Run> {
    Step::new("Regenerate SDK code")
        .run(indoc::indoc! {r#"
            bun install --frozen-lockfile
            bun run sync-specs
            bun run generate
        "#})
        .working_directory(xtask_paths::repo_dir!("packages/sdk"))
}

/// Renders `apps/docs/AI/mcp/tools/` from the `gen_tool_schemas` binary, so a
/// tool's schema or description change cannot leave the docs site behind.
fn regenerate_tool_pages() -> Step<Run> {
    Step::new("Regenerate MCP tool pages")
        .run("bun run generate:tools")
        .working_directory(xtask_paths::repo_dir!("apps/docs"))
}

fn verify_fresh(name: &str, dir: &str, stale_message: &str) -> Step<Run> {
    Step::new(name).run(format!(
        r#"if [ -n "$(git status --porcelain -- {dir})" ]; then
  echo "{stale_message}"
  git status --porcelain -- {dir}
  git diff -- {dir} | head -200
  exit 1
fi
"#
    ))
}

fn check_types() -> Step<Run> {
    Step::new("Check Types")
        .run("bun run --bun --silent tsc --project ./tsconfig.json")
        .working_directory(xtask_paths::repo_dir!("apps/web"))
}

fn check_dynamic_ui_schema() -> Step<Run> {
    Step::new("Check Dynamic UI Schema")
        .run("bun run check-dynamic-ui-schema")
        .working_directory(xtask_paths::repo_dir!("apps/web"))
}

fn check_collaboration_types() -> Step<Run> {
    Step::new("Check Collaboration Package Types")
        .run("bun run type-check")
        .working_directory(xtask_paths::repo_dir!("packages/collaboration"))
}

fn check_lexical_service_types() -> Step<Run> {
    Step::new("Check Lexical Service Types")
        .run("bun run check")
        .working_directory(xtask_paths::repo_dir!("services/lexical-service"))
}

fn test_lexical_service() -> Step<Run> {
    Step::new("Test Lexical Service Endpoints")
        .run("bun test src")
        .working_directory(xtask_paths::repo_dir!("services/lexical-service"))
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

fn run_tests() -> Step<Run> {
    Step::new("Test")
        .run("bunx vitest")
        .working_directory(xtask_paths::repo_dir!("apps/web"))
}

/// Sign-in, sign-up, and onboarding against their fake backends: real views in
/// Chromium, no network, so they run on every web PR.
fn run_signup_browser_tests() -> Step<Run> {
    Step::new("Sign-up Browser Tests")
        .run("just test-signup-browser")
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
        echo "generated-code: ${{ needs.generated-code.result }}"
        echo "biome-check: ${{ needs.biome-check.result }}"
        echo "test: ${{ needs.test.result }}"
        echo "cycles: ${{ needs.cycles.result }}"
        echo "build: ${{ needs.build.result }}"

        # Fail if any job failed (skipped and success are both OK)
        if [[ "${{ needs.path-check.result }}" == "failure" ]] || \
           [[ "${{ needs.typescript.result }}" == "failure" ]] || \
           [[ "${{ needs.generated-code.result }}" == "failure" ]] || \
           [[ "${{ needs.biome-check.result }}" == "failure" ]] || \
           [[ "${{ needs.test.result }}" == "failure" ]] || \
           [[ "${{ needs.cycles.result }}" == "failure" ]] || \
           [[ "${{ needs.build.result }}" == "failure" ]]; then
          echo "One or more jobs failed"
          exit 1
        fi

        echo "All jobs passed or were skipped"
    "#})
}
