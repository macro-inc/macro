//! `Web App Pr Checks` — frontend and mobile PR checks.
//! Generated into `web-app-check-main.yml`.

use gh_workflow::{
    Concurrency, Event, Expression, Job, Level, Permissions, PullRequest, PullRequestType, Run,
    Step, Strategy, Use, Workflow,
};

use crate::workflows::{
    runners,
    steps::{self, FluentBuilder},
    vars,
};

mod android_native_check;
mod ios_native_check;
mod preview;
#[cfg(test)]
mod test;

/// Frontend-only jobs share one small Namespace profile with a dedicated cache
/// tag, so their Nix/Bun state lives on its own volume.
fn web_runner() -> String {
    runners::Runner::Small.with_cache_tag(vars::WEB_CI_CACHE_TAG)
}

/// The mid-size (16x32) profile on the web CI cache volume and remote sccache,
/// for the jobs that scale with cores: the app build compiles the browser wasm
/// packages and runs
/// Vite, typechecking runs the TS 7 compiler, and vitest runs about 1.9x faster
/// on 16 cores than on the small profile's 8.
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
        .add_job(android_native_check::JOB_ID, android_native_check())
        .add_job("typescript", typescript())
        .add_job("biome-check", biome_check())
        .add_job("test", test())
        .add_job("functional", functional())
        .add_job("browser", browser())
        .add_job("cycles", cycles())
        .add_job("build", build())
        .add_job(ios_native_check::JOB_ID, ios_native_check::job())
        .add_job("status-check", status_check())
}

/// Always run so the required collector can distinguish a successful native
/// check from a cancelled or skipped one, including frontend/backend-only PRs.
fn android_native_check() -> Job {
    android_native_check::job()
}

fn path_check() -> Job {
    Job::default()
        .runs_on(runners::Runner::TinyNoCache.to_string())
        .add_output("should_run", "${{ steps.filter.outputs.should_run }}")
        .add_output(
            "web_artifact_changed",
            "${{ steps.filter.outputs.web_artifact_changed }}",
        )
        .add_output("i18n_changed", "${{ steps.filter.outputs.i18n_changed }}")
        .add_output(
            "database_grid_changed",
            "${{ steps.filter.outputs.database_grid_changed }}",
        )
        .add_output(
            "calendar_details_changed",
            "${{ steps.filter.outputs.calendar_details_changed }}",
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
        .add_step(check_types())
        .add_step(check_floating_promises())
        .add_step(check_functional_test_types())
        .add_step(check_collaboration_types())
        .add_step(check_lexical_service_types())
        .add_step(test_lexical_service())
        .add_step(
            Step::new("Install SDK Documentation Dependencies")
                .run("bun install --frozen-lockfile")
                .working_directory(xtask_paths::repo_dir!("packages/sdk")),
        )
        .add_step(
            Step::new("Check SDK Documentation")
                .run("bun run type-check && bun run test")
                .working_directory(xtask_paths::repo_dir!("packages/sdk-docs")),
        )
        .add_step(
            Step::new("Check Editing Worker")
                .run("bun run type-check")
                .working_directory(xtask_paths::repo_dir!("services/ai-editing-worker")),
        )
        .add_step(
            Step::new("Check Code Mode SDK")
                .run("bun run type-check && bun run test")
                .working_directory(xtask_paths::repo_dir!("packages/code-mode-sdk")),
        )
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
        .add_step(check_platform_rules())
        .add_step(steps::teardown_nix())
}

fn test() -> Job {
    gated_web_job("Test (${{ matrix.shard }}/3)")
        .runs_on(mid_web_runner())
        .strategy(
            Strategy::default()
                .fail_fast(false)
                .matrix(serde_json::json!({ "shard": [1, 2, 3] })),
        )
        .add_step(checkout("Checkout Repo", false))
        .add_step(steps::mount_web_test_cache_volume())
        .add_step(steps::setup_nix())
        .add_step(steps::setup_reqs_web("Setup", false))
        .add_step(steps::configure_namespace_sccache(vars::WEB_SCCACHE_NAME))
        .add_step(build_agent_fold_for_tests())
        .add_step(run_tests())
        .add_step(steps::teardown_nix())
}

/// The functional suite bundles fixtures that import every wasm package, so this
/// job restores or builds them; unchanged packages come from the shared cache.
fn functional() -> Job {
    gated_web_job("Functional Tests")
        .runs_on(mid_web_runner())
        .add_step(checkout("Checkout Repo", false))
        .add_step(steps::mount_web_build_check_cache_volume())
        .add_step(steps::setup_nix())
        .add_step(steps::setup_reqs_web("Setup", true))
        .add_step(steps::configure_namespace_sccache(vars::WEB_SCCACHE_NAME))
        .add_step(steps::start_sccache_server())
        .add_step(build_wasm_for_functional_tests())
        .add_step(run_functional_tests())
        .add_step(steps::show_sccache_stats())
        .add_step(steps::teardown_nix())
}

/// Browser suites that only need the agent-fold package, including the ones that
/// run only when their paths change. Apart from vitest and the app build so
/// neither waits for them.
fn browser() -> Job {
    gated_web_job("Browser Tests")
        .runs_on(mid_web_runner())
        .add_step(checkout("Checkout Repo", false))
        .add_step(steps::mount_web_test_cache_volume())
        .add_step(steps::setup_nix())
        .add_step(steps::setup_reqs_web("Setup", true))
        .add_step(steps::configure_namespace_sccache(vars::WEB_SCCACHE_NAME))
        .add_step(build_agent_fold_for_tests())
        .add_step(run_signup_browser_tests())
        .add_step(run_i18n_browser_tests())
        .add_step(run_database_browser_tests())
        .add_step(run_calendar_details_browser_tests())
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
    let (preview_credentials, preview_steps) = preview::steps();
    let job = gated_web_job("Build")
        // Match preview/deploy capacity for Vite's chunk-rendering memory peak.
        .runs_on(mid_web_runner())
        .permissions(
            Permissions::default()
                .contents(Level::Read)
                .pull_requests(Level::Write),
        )
        .add_step(checkout("Checkout Repo", false))
        .add_step(steps::mount_web_build_check_cache_volume())
        .add_step(steps::setup_nix())
        .add_step(steps::setup_reqs_web("Setup", false))
        .add_step(steps::configure_namespace_sccache(vars::WEB_SCCACHE_NAME))
        .add_step(steps::start_sccache_server())
        .add_step(run_build())
        .add_step(steps::show_sccache_stats())
        .add_step(preview_credentials);
    preview_steps
        .into_iter()
        .fold(job, Job::add_step)
        .add_step(steps::teardown_nix())
}

/// Always-run collector used as the required status check. Its name must stay
/// stable because branch protection can reference it. New gates join the
/// `needs` list (and [`check_job_results`]) rather than the ruleset: the
/// [`ios_native_check`] job is required this way.
fn status_check() -> Job {
    Job::default()
        .name("Web App Status Check")
        .cond(Expression::new("always()"))
        .needs(vec![
            "path-check".to_string(),
            android_native_check::JOB_ID.to_string(),
            "typescript".to_string(),
            "biome-check".to_string(),
            "test".to_string(),
            "functional".to_string(),
            "browser".to_string(),
            "cycles".to_string(),
            "build".to_string(),
            ios_native_check::JOB_ID.to_string(),
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

    // The Nix dev-shell action, xtask, flake.nix and this workflow file are left
    // out of `should_run`, so Typecheck stays off for a shell-only tweak. Workflow
    // YAML drift is `check generated workflows`. `i18n_changed` covers what the
    // interface language browser tests render: translations, the menu primitives,
    // and settings navigation. `database_grid_changed` covers the database grid's
    // browser tests. `calendar_details_changed` covers what the event details
    // browser tests render and the query modules their fixture replaces, whose
    // exports the fixture must keep matching.
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
                "should_run:\n{artifact_paths}  - 'services/lexical-service/**'\n  - 'packages/sdk/**'\n  - 'packages/sdk-docs/**'\n  - 'services/ai-editing-worker/**'\n  - 'packages/code-mode-sdk/**'\n  - 'crates/agent_code_mode/SKILL.md'\n  - '.github/actions/setup-reqs-web/**'\nweb_artifact_changed:\n{artifact_paths}i18n_changed:\n  - 'apps/web/src/lib/i18n/**'\n  - 'apps/web/src/lib/core/component/ContextMenu.tsx'\n  - 'apps/web/src/lib/core/constant/settingsTabsConfig.tsx'\n  - 'apps/web/src/components/ui/components/Dropdown.tsx'\n  - 'apps/web/src/features/settings/**'\ndatabase_grid_changed:\n  - 'apps/web/src/features/database/**'\ncalendar_details_changed:\n  - 'apps/web/src/features/calendar-view/**'\n  - 'apps/web/src/features/calendar/**'\n  - 'apps/web/src/lib/queries/calendar/**'\n"
            ),
        ))
}

/// `type-check` runs the native TypeScript 7 compiler.
fn check_types() -> Step<Run> {
    Step::new("Check Types")
        .run("bun run type-check")
        .working_directory(xtask_paths::repo_dir!("apps/web"))
}

/// Type-aware oxlint over all of `apps/web`; `no-floating-promises` is an
/// error and needs type information to run at all.
fn check_floating_promises() -> Step<Run> {
    Step::new("Check Floating Promises").run("bun run lint:oxlint --quiet")
}

fn check_functional_test_types() -> Step<Run> {
    Step::new("Check Functional Test Types")
        .run("bun ../../node_modules/typescript-native/bin/tsc --noEmit --skipLibCheck --project tests/functional/tsconfig.json")
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

/// Runs the browser-floor and native media permission ast-grep rules here
/// because Conventions, which runs every ast-grep rule, is not a required check.
fn check_platform_rules() -> Step<Run> {
    Step::new("Check Browser Floor and Native Permissions").run(
        "bunx --yes @ast-grep/cli@0.44.1 scan --filter '^(tsx?-browser-floor-apis|plist-media-.+)$'",
    )
}

fn run_collaboration_biome() -> Step<Run> {
    Step::new("Run Collaboration Package Biome")
        .run("biome ci --changed --no-errors-on-unmatched --error-on-warnings")
        .working_directory(xtask_paths::repo_dir!("packages/collaboration"))
}

// Keep cold Rust/WASM compilation outside Vitest’s five-minute setup hook.
fn build_agent_fold_for_tests() -> Step<Run> {
    Step::new("Build agent-fold WASM for tests")
        .run("just build-agent-fold-wasm")
        .add_env(("WASM_PKG_CACHE_DIR", vars::WASM_PKG_CACHE_DIR))
        .working_directory(xtask_paths::repo_dir!("apps/web"))
        .timeout_minutes(15u32)
}

/// `bun run test` enables Vitest's filesystem module cache; the cache volume
/// keeps it warm across jobs.
fn run_tests() -> Step<Run> {
    Step::new("Test")
        .run("bun run test --shard=${{ matrix.shard }}/3")
        .add_env((
            "VITEST_MODULE_CACHE_DIR",
            vars::VITEST_MODULE_CACHE_VOLUME_DIR,
        ))
        .working_directory(xtask_paths::repo_dir!("apps/web"))
}

fn build_wasm_for_functional_tests() -> Step<Run> {
    with_pr_wasm_env(
        Step::new("Build wasm packages")
            .run("just build-wasm")
            .working_directory(xtask_paths::repo_dir!("apps/web")),
    )
}

fn run_functional_tests() -> Step<Run> {
    Step::new("Functional Browser Tests")
        .run("bun run test:functional")
        .add_env(("FUNCTIONAL_TEST_WORKERS", "8"))
        .working_directory(xtask_paths::repo_dir!("apps/web"))
}

/// Sign-in, sign-up, and onboarding against their fake backends: real views in
/// Chromium, no network, so they run on every web PR.
fn run_signup_browser_tests() -> Step<Run> {
    Step::new("Sign-up Browser Tests")
        .run("just test-signup-browser")
        .working_directory(xtask_paths::repo_dir!("apps/web"))
}

/// Menus in every interface language, failing on clipped labels. Only when
/// translations or the surfaces they render on change. A cached browser skips
/// `--with-deps`, which installs the Thai, CJK, and Devanagari fonts; without
/// them Chromium draws each character as a box and long labels look clipped.
fn run_i18n_browser_tests() -> Step<Run> {
    Step::new("Interface Language Browser Tests")
        .run("bunx playwright install-deps chromium\njust test-i18n-browser")
        .if_condition(Expression::new(
            "needs.path-check.outputs.i18n_changed == 'true'",
        ))
        .working_directory(xtask_paths::repo_dir!("apps/web"))
}

/// Rows and cells measured under remote presence in Chromium. Only when the
/// database grid changes.
fn run_database_browser_tests() -> Step<Run> {
    Step::new("Database Grid Browser Tests")
        .run("bunx playwright install-deps chromium\njust test-database-browser")
        .if_condition(Expression::new(
            "needs.path-check.outputs.database_grid_changed == 'true'",
        ))
        .working_directory(xtask_paths::repo_dir!("apps/web"))
}

/// Event details placement and guest editors in desktop and phone Chromium,
/// over preview adapters instead of a backend. Only when calendar details or
/// the calendar queries the adapters stand in for change.
fn run_calendar_details_browser_tests() -> Step<Run> {
    Step::new("Calendar Event Details Browser Tests")
        .run("bunx playwright install-deps chromium\njust test-calendar-details-browser")
        .if_condition(Expression::new(
            "needs.path-check.outputs.calendar_details_changed == 'true'",
        ))
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

/// Whole-program LTO costs the fig, psd and ai engines about 40 s each and only
/// makes them faster to run, which a PR's tests and preview don't need. Deploys
/// keep it. The wasm package cache doesn't key on these, so only PR jobs, which
/// all set them, may read it.
const PR_WASM_ENV: [(&str, &str); 6] = [
    ("CARGO_PROFILE_FIG_ENGINE_WASM_LTO", "off"),
    ("CARGO_PROFILE_FIG_ENGINE_WASM_CODEGEN_UNITS", "16"),
    ("CARGO_PROFILE_PSD_ENGINE_WASM_LTO", "off"),
    ("CARGO_PROFILE_PSD_ENGINE_WASM_CODEGEN_UNITS", "16"),
    ("CARGO_PROFILE_AI_ENGINE_WASM_LTO", "off"),
    ("CARGO_PROFILE_AI_ENGINE_WASM_CODEGEN_UNITS", "16"),
];

fn with_pr_wasm_env(step: Step<Run>) -> Step<Run> {
    PR_WASM_ENV
        .into_iter()
        .fold(step, Step::add_env)
        .add_env(("WASM_PKG_CACHE_DIR", vars::WASM_PKG_CACHE_DIR))
}

fn run_build() -> Step<Run> {
    preview::build_env().into_iter().fold(
        with_pr_wasm_env(
            Step::new("Build")
                .run("just build-dev")
                .working_directory(xtask_paths::repo_dir!("apps/web")),
        ),
        Step::add_env,
    )
}

fn check_job_results() -> Step<Run> {
    Step::new("Check job results").run(indoc::indoc! {r#"
        echo "path-check: ${{ needs.path-check.result }}"
        echo "android-native-check: ${{ needs.android-native-check.result }}"
        echo "typescript: ${{ needs.typescript.result }}"
        echo "biome-check: ${{ needs.biome-check.result }}"
        echo "test: ${{ needs.test.result }}"
        echo "functional: ${{ needs.functional.result }}"
        echo "browser: ${{ needs.browser.result }}"
        echo "cycles: ${{ needs.cycles.result }}"
        echo "build: ${{ needs.build.result }}"
        echo "ios-native-check: ${{ needs.ios-native-check.result }}"

        # Fail if any job failed (skipped and success are both OK). The iOS
        # gate is the merge gate, so a cancelled gate is not OK either.
        if [[ "${{ needs.android-native-check.result }}" != "success" ]] || \
           [[ "${{ needs.path-check.result }}" == "failure" ]] || \
           [[ "${{ needs.typescript.result }}" == "failure" ]] || \
           [[ "${{ needs.biome-check.result }}" == "failure" ]] || \
           [[ "${{ needs.test.result }}" == "failure" ]] || \
           [[ "${{ needs.functional.result }}" == "failure" ]] || \
           [[ "${{ needs.browser.result }}" == "failure" ]] || \
           [[ "${{ needs.cycles.result }}" == "failure" ]] || \
           [[ "${{ needs.build.result }}" == "failure" ]] || \
           [[ "${{ needs.ios-native-check.result }}" == "failure" ]] || \
           [[ "${{ needs.ios-native-check.result }}" == "cancelled" ]]; then
          echo "One or more jobs failed"
          exit 1
        fi

        echo "All jobs passed or were skipped"
    "#})
}
