//! `Web App Pr Checks` — frontend and mobile PR checks.
//! Generated into `web-app-check-main.yml`.

use gh_workflow::{
    Event, Expression, Job, Level, Permissions, Run, Step, Strategy, Use, Workflow, WorkflowCall,
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
/// for the jobs that scale with cores: the generated-code job compiles the
/// schema binaries, the app build compiles the browser wasm packages and runs
/// Vite, typechecking runs the TS 7 compiler, and vitest runs about 1.9x faster
/// on 16 cores than on the small profile's 8.
fn mid_web_runner() -> String {
    runners::Runner::Mid.with_cache_tag(vars::WEB_CI_CACHE_TAG)
}

/// Build the workflow.
pub fn web_app_check_main() -> Workflow {
    Workflow::new("Web App Pr Checks")
        .on(Event::default().workflow_call(WorkflowCall::default()))
        .add_job("path-check", path_check())
        .add_job(android_native_check::JOB_ID, android_native_check())
        .add_job("typescript", typescript())
        .add_job("generated-code", generated_code())
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
            "codegen_changed",
            "${{ steps.codegen.outputs.codegen_changed }}",
        )
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
        .add_step(path_check_checkout())
        .add_step(paths_filter())
        .add_step(detect_schema_changes())
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
        .add_step(steps::setup_nix_with_seed())
        .add_step(steps::setup_reqs_web("Setup Prereqs", false))
        .add_step(
            Step::new("Install SDK Documentation Dependencies")
                .run("bun install --frozen-lockfile")
                .working_directory(xtask_paths::repo_dir!("packages/sdk")),
        )
        .add_step(typecheck_in_parallel())
        .add_step(steps::teardown_nix())
}

/// Typecheck's checks, each `(name, directory, command)`. They read the same
/// installed tree and write nothing, so they run at once: in sequence they took
/// about 106 s of a 179 s job. `packages/sdk` isn't a workspace member, so the
/// SDK documentation's dependencies install first, as they did before.
const TYPECHECKS: [(&str, &str, &str); 11] = [
    // `type-check` runs the native TypeScript 7 compiler.
    ("Check Types", "apps/web", "bun run type-check"),
    // Type-aware oxlint over all of `apps/web`; `no-floating-promises` is an
    // error and needs type information to run at all.
    (
        "Check Floating Promises",
        ".",
        "bun run lint:oxlint --quiet",
    ),
    (
        "Check Functional Test Types",
        "apps/web",
        "bun ../../node_modules/typescript-native/bin/tsc --noEmit --skipLibCheck --project tests/functional/tsconfig.json",
    ),
    (
        "Check Collaboration Package Types",
        "packages/collaboration",
        "bun run type-check",
    ),
    (
        "Check Lexical Service Types",
        "services/lexical-service",
        "bun run check",
    ),
    (
        "Test Lexical Service Endpoints",
        "services/lexical-service",
        "bun test src",
    ),
    (
        "Check SDK Documentation",
        "packages/sdk-docs",
        "bun run type-check && bun run test",
    ),
    (
        "Check Editing Worker",
        "services/ai-editing-worker",
        "bun run type-check",
    ),
    (
        "Check Code Mode SDK",
        "packages/code-mode-sdk",
        "bun run type-check && bun run test",
    ),
    (
        "Check SDK MCP Tools",
        "packages/sdk-mcp",
        "bun run type-check && bun run test",
    ),
    (
        "Check MCP ChatGPT Worker",
        "services/mcp-chatgpt-worker",
        "bun run type-check && bun run test",
    ),
];

/// Runs [`TYPECHECKS`] concurrently. Each check's output is printed as its own
/// group once all finish, every failure is annotated by name, and the step fails
/// if any check does.
fn typecheck_in_parallel() -> Step<Run> {
    Step::new("Run checks").run(typecheck_script(&TYPECHECKS))
}

fn typecheck_script(checks: &[(&str, &str, &str)]) -> String {
    let mut script = String::from(indoc::indoc! {r#"
        set -uo pipefail
        logs="$RUNNER_TEMP/typecheck"
        mkdir -p "$logs"
        names=()
        pids=()
        check() {
          local name="$1" directory="$2" command="$3"
          ( cd "$directory" && eval "$command" ) > "$logs/${#names[@]}.log" 2>&1 &
          names+=("$name")
          pids+=("$!")
        }
    "#});
    for (name, directory, command) in checks {
        script.push_str(&format!("check '{name}' '{directory}' '{command}'\n"));
    }
    script.push_str(indoc::indoc! {r#"
        failed=0
        for index in "${!names[@]}"; do
          status=0
          wait "${pids[$index]}" || status=$?
          echo "::group::${names[$index]} (exit $status)"
          cat "$logs/$index.log"
          echo "::endgroup::"
          if [ "$status" -ne 0 ]; then
            echo "::error::${names[$index]} failed with exit code $status"
            failed=1
          fi
        done
        exit "$failed"
    "#});
    script
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
        .timeout_minutes(45u32)
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
        .add_step(steps::setup_nix_with_seed())
        .add_step(
            steps::setup_reqs_web("Setup Prereqs", false)
                .timeout_minutes(vars::DEV_SHELL_TIMEOUT_MINUTES),
        )
        .add_step(steps::configure_namespace_sccache(vars::WEB_SCCACHE_NAME))
        .add_step(steps::code_mode_assets())
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
        .add_step(steps::setup_nix_with_seed())
        .add_step(steps::setup_dev_shell())
        .add_step(run_biome())
        .add_step(run_collaboration_biome())
        .add_step(check_platform_rules())
        .add_step(steps::teardown_nix())
}

fn test() -> Job {
    gated_web_job("Test (${{ matrix.shard }}/6)")
        .runs_on(mid_web_runner())
        .strategy(
            Strategy::default()
                .fail_fast(false)
                .matrix(serde_json::json!({ "shard": [1, 2, 3, 4, 5, 6] })),
        )
        .add_step(checkout("Checkout Repo", false))
        .add_step(steps::mount_web_test_cache_volume())
        .add_step(steps::setup_nix_with_seed())
        .add_step(steps::setup_reqs_web("Setup", false))
        .add_step(steps::configure_namespace_sccache(vars::WEB_SCCACHE_NAME))
        .add_step(build_agent_fold_for_tests())
        .add_step(build_natural_time_for_tests())
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
        .add_step(steps::setup_nix_with_seed())
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
        .add_step(steps::setup_nix_with_seed())
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
        .add_step(steps::setup_nix_with_seed())
        .add_step(steps::setup_dev_shell())
        .add_step(cycles_import_check())
        .add_step(collaboration_cycles_import_check())
        .add_step(steps::teardown_nix())
}

/// The one web job without the Nix seed: it holds the preview deploy's AWS
/// credentials, and PR jobs write the seed.
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
            "generated-code".to_string(),
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

/// The filter reads the PR's files from the API and [`detect_schema_changes`]
/// reads trees and a few blobs, so path-check fetches no blobs up front and
/// writes almost no work tree: 18 s became 6 s on the tiny runner.
fn path_check_checkout() -> Step<Use> {
    checkout("Checkout Repo", false)
        .add_with(("filter", "blob:none"))
        .add_with(("sparse-checkout", ".github"))
}

/// Whether a pull request can change generated output. Schemas come from
/// `utoipa`, `specta` and `schemars` items, so a Rust file naming none of them,
/// before or after the change, can't alter one. Replayed over 1,021 commits on
/// `main` (a span where the job blocked every merge, so any schema change shipped
/// with its generated output): this skips 44% of them and missed none of the 378
/// that changed generated output. A schema crate's version change still counts.
fn detect_schema_changes() -> Step<Run> {
    Step::new("Detect schema changes")
        .run(DETECT_SCHEMA_CHANGES)
        .id("codegen")
        .add_env((
            "CODEGEN_INPUTS",
            "${{ steps.filter.outputs.codegen_inputs }}",
        ))
}

/// The checkout is blobless, so `git diff` and `git show` fetch blobs as they
/// read them. Each read is its own command, so a failed fetch fails the step
/// instead of reading as "no schema item"; a file absent from one revision is
/// skipped by a tree lookup, which needs no blob.
const DETECT_SCHEMA_CHANGES: &str = indoc::indoc! {r#"
    set -euo pipefail
    result() {
      echo "$1"
      echo "codegen_changed=$2" >> "$GITHUB_OUTPUT"
      exit 0
    }
    [ "$CODEGEN_INPUTS" = true ] && result "A generator input changed." true
    # The merge commit's first parent is the main this merge result was
    # built on; a fresh fetch of main could be newer.
    base=$(git cat-file -p HEAD | sed -n 's/^parent //p' | sed -n 1p)
    [ -n "$base" ] || result "No base commit to compare with." true
    git fetch -q --depth=1 origin "$base"
    names='utoipa|ToSchema|IntoParams|specta|schemars|JsonSchema'
    manifests=$(git diff "$base" HEAD -- Cargo.toml Cargo.lock)
    if grep -E "^[-+].*($names)" <<< "$manifests"; then
      result "A schema crate's version changed." true
    fi
    changed=$(git diff --name-only --no-renames "$base" HEAD -- 'crates/*.rs' 'services/*.rs')
    while IFS= read -r file; do
      [ -n "$file" ] || continue
      for revision in HEAD "$base"; do
        [ -n "$(git ls-tree "$revision" -- "$file")" ] || continue
        contents=$(git show "$revision:$file")
        if grep -E "$names" <<< "$contents" > /dev/null; then
          result "$file names a schema item." true
        fi
      done
    done <<< "$changed"
    result "No changed Rust file names a schema item." false
"#};

fn paths_filter() -> Step<Use> {
    let artifact_paths = crate::workflows::web_artifact_paths::yaml_list("  ");

    // `codegen_inputs` holds the `gen-api` scripts and the SDK and docs packages
    // that hold generated output; [`detect_schema_changes`] reads Rust changes
    // from git. xtask, flake.nix, the Nix dev-shell action, and
    // this workflow file do not change generated output, so they must not start
    // that job. The Nix dev-shell action is also omitted from `should_run` so
    // Typecheck stays off for a shell-only tweak. Workflow YAML drift is `check
    // generated workflows`. `i18n_changed` covers what the interface language
    // browser tests render: translations, the menu primitives, and settings
    // navigation. `database_grid_changed` covers the database grid's browser
    // tests. `calendar_details_changed` covers what the event details browser
    // tests render and the query modules their fixture replaces, whose exports
    // the fixture must keep matching.
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
                "should_run:\n{artifact_paths}  - 'services/lexical-service/**'\n  - 'packages/sdk/**'\n  - 'packages/sdk-docs/**'\n  - 'services/ai-editing-worker/**'\n  - 'services/mcp-chatgpt-worker/**'\n  - 'packages/code-mode-sdk/**'\n  - 'crates/agent_code_mode/SKILL.md'\n  - '.github/actions/setup-reqs-web/**'\nweb_artifact_changed:\n{artifact_paths}codegen_inputs:\n  - 'apps/web/scripts/generate-api-schema.ts'\n  - 'apps/web/scripts/services.ts'\n  - 'packages/sdk/**'\n  - 'apps/docs/**'\n  - '.github/actions/setup-reqs-web/**'\ni18n_changed:\n  - 'apps/web/src/lib/i18n/**'\n  - 'apps/web/src/lib/core/component/ContextMenu.tsx'\n  - 'apps/web/src/lib/core/constant/settingsTabsConfig.tsx'\n  - 'apps/web/src/components/ui/components/Dropdown.tsx'\n  - 'apps/web/src/features/settings/**'\ndatabase_grid_changed:\n  - 'apps/web/src/features/database/**'\ncalendar_details_changed:\n  - 'apps/web/src/features/calendar-view/**'\n  - 'apps/web/src/features/calendar/**'\n  - 'apps/web/src/lib/queries/calendar/**'\n"
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
        SQLX_OFFLINE=true cargo build "${openapi_bins[@]}" --bin gen_tool_schemas \
          --bin agent_fold_types --bin export_review_types
    "#})
}

fn generate_api_types() -> Step<Run> {
    Step::new("Generate API Types")
        .run("bun run gen-api -- --check")
        .working_directory(xtask_paths::repo_dir!("apps/web"))
}

/// `gen-api` covers the OpenAPI clients; the types specta writes from the
/// wire types of the two browser wasm crates, the dynamic-UI view and the agent
/// review types are regenerated here, so a Rust change cannot leave them behind.
fn check_specta_types() -> Step<Run> {
    Step::new("Check Specta Types")
        .run(indoc::indoc! {r#"
            just gen-agent-fold-types
            just gen-database-sql-types
            just gen-dynamic-ui-types
            just gen-agent-review-types
            if ! git diff --exit-code -- src/lib/service-clients/service-agent-fold/generated src/lib/core/database-sql/generated src/features/dynamic-ui/generated ../../packages/lexical-core/generated src/lib/service-clients/service-agent-reviews/generated ../../packages/sdk/generated/agent-reviews; then
              echo "Generated specta types are stale. Run 'just gen-agent-fold-types', 'just gen-database-sql-types', 'just gen-dynamic-ui-types' and 'just gen-agent-review-types' in apps/web and commit the result."
              exit 1
            fi
        "#})
        .working_directory(xtask_paths::repo_dir!("apps/web"))
        // Two of the four exporters come from the build step, built with the same
        // feature resolution as the schema binaries. `cargo run -p` resolves the
        // features of one package's dependencies, which recompiled 101 and 131
        // crates for them. The other two need a `cli` feature that would change
        // the libraries every schema binary links, so they keep `cargo run -p`.
        .add_env(("SPECTA_BIN_DIR", "${{ github.workspace }}/target/debug"))
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

fn build_natural_time_for_tests() -> Step<Run> {
    Step::new("Build natural-time WASM for tests")
        .run("just build-natural-time-wasm")
        .add_env(("WASM_PKG_CACHE_DIR", vars::WASM_PKG_CACHE_DIR))
        .working_directory(xtask_paths::repo_dir!("apps/web"))
        .timeout_minutes(15u32)
}

/// `bun run test` enables Vitest's filesystem module cache; the cache volume
/// keeps it warm across jobs.
fn run_tests() -> Step<Run> {
    Step::new("Test")
        .run("bun run test --shard=${{ matrix.shard }}/6")
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
        echo "generated-code: ${{ needs.generated-code.result }}"
        echo "biome-check: ${{ needs.biome-check.result }}"
        echo "test: ${{ needs.test.result }}"
        echo "functional: ${{ needs.functional.result }}"
        echo "browser: ${{ needs.browser.result }}"
        echo "cycles: ${{ needs.cycles.result }}"
        echo "build: ${{ needs.build.result }}"
        echo "ios-native-check: ${{ needs.ios-native-check.result }}"

        # Fail if any job failed (skipped and success are both OK). The iOS
        # gate is the merge gate, so a cancelled gate is not OK either. The same
        # goes for generated code: a job that hits its timeout reports cancelled.
        if [[ "${{ needs.android-native-check.result }}" != "success" ]] || \
           [[ "${{ needs.path-check.result }}" == "failure" ]] || \
           [[ "${{ needs.typescript.result }}" == "failure" ]] || \
           [[ "${{ needs.generated-code.result }}" == "failure" ]] || \
           [[ "${{ needs.generated-code.result }}" == "cancelled" ]] || \
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
