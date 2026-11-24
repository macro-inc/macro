//! `Web App Pr Checks` — frontend and mobile PR checks.
//! Generated into `web-app-check-main.yml`.

use gh_workflow::expr::typed::{
    Flag, JobHandle, JobOutput, Num, StepHandle, StepOutput, github, matrix,
};
use gh_workflow::{
    Event, Job, Level, Permissions, Run, Step, Strategy, Use, Workflow, WorkflowCall, ZizmorRule,
};

use crate::workflows::actions::{ActionsCheckout, DornyPathsFilter};
use crate::workflows::{runners, steps, vars};

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
/// schema binaries (on its own cache tag), the app build compiles the browser wasm packages and runs
/// Vite, typechecking runs the TS 7 compiler, and vitest runs about 1.9x faster
/// on 16 cores than on the small profile's 8.
fn mid_web_runner() -> String {
    runners::Runner::Mid.with_cache_tag(vars::WEB_CI_CACHE_TAG)
}

struct PathCheckOutputs {
    /// Whether the web checks should run at all.
    should_run: JobOutput<Flag>,
    /// Whether the change can alter generated code.
    codegen_changed: JobOutput<Flag>,
    /// Whether the change can alter the web bundle.
    web_artifact_changed: JobOutput<Flag>,
    /// Whether the interface language browser tests' surfaces changed.
    i18n_changed: JobOutput<Flag>,
    /// Whether the database grid browser tests' surfaces changed.
    database_grid_changed: JobOutput<Flag>,
    /// Whether the event details browser tests' surfaces changed.
    calendar_details_changed: JobOutput<Flag>,
    /// Whether the agent screen browser tests' surfaces changed.
    agent_screen_changed: JobOutput<Flag>,
}

const PATH_CHECK: JobHandle<PathCheckOutputs> = JobHandle::new(
    "path-check",
    PathCheckOutputs {
        should_run: JobOutput::new("path-check", "should_run"),
        codegen_changed: JobOutput::new("path-check", "codegen_changed"),
        web_artifact_changed: JobOutput::new("path-check", "web_artifact_changed"),
        i18n_changed: JobOutput::new("path-check", "i18n_changed"),
        database_grid_changed: JobOutput::new("path-check", "database_grid_changed"),
        calendar_details_changed: JobOutput::new("path-check", "calendar_details_changed"),
        agent_screen_changed: JobOutput::new("path-check", "agent_screen_changed"),
    },
);

const TYPESCRIPT: JobHandle<()> = JobHandle::new("typescript", ());
const GENERATED_CODE: JobHandle<()> = JobHandle::new("generated-code", ());
const BIOME_CHECK: JobHandle<()> = JobHandle::new("biome-check", ());
const TEST: JobHandle<()> = JobHandle::new("test", ());
const FUNCTIONAL: JobHandle<()> = JobHandle::new("functional", ());
const BROWSER: JobHandle<()> = JobHandle::new("browser", ());
const CYCLES: JobHandle<()> = JobHandle::new("cycles", ());
const BUILD: JobHandle<()> = JobHandle::new("build", ());

struct FilterOutputs {
    /// The `should_run` filter's match.
    should_run: StepOutput<Flag>,
    /// The `web_artifact_changed` filter's match.
    web_artifact_changed: StepOutput<Flag>,
    /// The `codegen_inputs` filter's match.
    codegen_inputs: StepOutput<Flag>,
    /// The `i18n_changed` filter's match.
    i18n_changed: StepOutput<Flag>,
    /// The `database_grid_changed` filter's match.
    database_grid_changed: StepOutput<Flag>,
    /// The `calendar_details_changed` filter's match.
    calendar_details_changed: StepOutput<Flag>,
    /// The `agent_screen_changed` filter's match.
    agent_screen_changed: StepOutput<Flag>,
}

const FILTER: StepHandle<FilterOutputs> = StepHandle::new(
    "filter",
    FilterOutputs {
        should_run: StepOutput::new("filter", "should_run"),
        web_artifact_changed: StepOutput::new("filter", "web_artifact_changed"),
        codegen_inputs: StepOutput::new("filter", "codegen_inputs"),
        i18n_changed: StepOutput::new("filter", "i18n_changed"),
        database_grid_changed: StepOutput::new("filter", "database_grid_changed"),
        calendar_details_changed: StepOutput::new("filter", "calendar_details_changed"),
        agent_screen_changed: StepOutput::new("filter", "agent_screen_changed"),
    },
);

struct CodegenOutputs {
    /// [`detect_schema_changes`]'s verdict.
    codegen_changed: StepOutput<Flag>,
}

const CODEGEN: StepHandle<CodegenOutputs> = StepHandle::new(
    "codegen",
    CodegenOutputs {
        codegen_changed: StepOutput::new("codegen", "codegen_changed"),
    },
);

/// Build the workflow.
pub fn web_app_check_main() -> Workflow {
    Workflow::new("Web App Pr Checks")
        .on(Event::default().workflow_call(WorkflowCall::default()))
        .add_job(PATH_CHECK, path_check())
        .add_job(android_native_check::JOB, android_native_check())
        .add_job(TYPESCRIPT, typescript())
        .add_job(GENERATED_CODE, generated_code())
        .add_job(BIOME_CHECK, biome_check())
        .add_job(TEST, test())
        .add_job(FUNCTIONAL, functional())
        .add_job(BROWSER, browser())
        .add_job(CYCLES, cycles())
        .add_job(BUILD, build())
        .add_job(ios_native_check::JOB, ios_native_check::job())
}

/// Always runs, on frontend- and backend-only PRs too, so `CI gate` sees the
/// native check pass rather than skip.
fn android_native_check() -> Job {
    android_native_check::job()
}

fn path_check() -> Job {
    Job::default()
        .timeout_minutes(10u32)
        .runs_on(runners::Runner::TinyNoCache.to_string())
        .add_output(
            PATH_CHECK.outputs.should_run.name(),
            FILTER.outputs.should_run.read(),
        )
        .add_output(
            PATH_CHECK.outputs.codegen_changed.name(),
            CODEGEN.outputs.codegen_changed.read(),
        )
        .add_output(
            PATH_CHECK.outputs.web_artifact_changed.name(),
            FILTER.outputs.web_artifact_changed.read(),
        )
        .add_output(
            PATH_CHECK.outputs.i18n_changed.name(),
            FILTER.outputs.i18n_changed.read(),
        )
        .add_output(
            PATH_CHECK.outputs.database_grid_changed.name(),
            FILTER.outputs.database_grid_changed.read(),
        )
        .add_output(
            PATH_CHECK.outputs.calendar_details_changed.name(),
            FILTER.outputs.calendar_details_changed.read(),
        )
        .add_output(
            PATH_CHECK.outputs.agent_screen_changed.name(),
            FILTER.outputs.agent_screen_changed.read(),
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
        .add_needs(PATH_CHECK)
        .cond(PATH_CHECK.outputs.should_run.read().is_set())
        .name("Typecheck")
        .timeout_minutes(15u32)
        .runs_on(mid_web_runner())
        // Entity icon permanence checks compare every committed name list.
        .add_step(checkout("Checkout Repo", true))
        .add_step(steps::prepare_blobless_checkout())
        .add_step(steps::mount_web_check_cache_volume(false))
        .add_step(steps::setup_nix_with_seed())
        .add_step(steps::setup_reqs_web("Setup Prereqs", false))
        .add_step(
            Step::new("Install SDK Documentation Dependencies")
                .run("bun install --frozen-lockfile")
                .working_directory(xtask_paths::repo_dir!("packages/sdk")),
        )
        // The agent runtime imports the SDK by its package exports, which
        // point at `dist/`.
        .add_step(
            Step::new("Build SDK")
                .run("bun run build")
                .working_directory(xtask_paths::repo_dir!("packages/sdk")),
        )
        .add_step(typecheck_in_parallel())
        .add_step(steps::teardown_nix())
}

/// Typecheck's checks, each `(name, directory, command)`. They read the same
/// installed tree and write nothing, so they run at once: in sequence they took
/// about 106 s of a 179 s job. The SDK is built first, for the agent runtime.
const TYPECHECKS: [(&str, &str, &str); 14] = [
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
        "Check Observability Package",
        "packages/observability",
        "bun run type-check && bun run test",
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
    (
        "Check Agent Runtime",
        "packages/muppet",
        "bun run typecheck && bun run test",
    ),
    // The template's own lockfile is what an agent's image installs from.
    (
        "Check Starter Agent",
        "packages/starter-agent",
        "bun run check && ../../tooling/scripts/starter-agent-lock.sh --check",
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
/// layer. These used to be checked by
/// three jobs in three workflows, each compiling the workspace again; one job
/// on one target dir builds the binaries once. The SDK regeneration reuses the
/// specs `gen-api` just wrote rather than rerunning it.
fn generated_code() -> Job {
    Job::default()
        .add_needs(PATH_CHECK)
        .cond(PATH_CHECK.outputs.codegen_changed.read().is_set())
        .name("Generated Code Check")
        .timeout_minutes(25u32)
        // Its own volume, so the `target` directory it keeps is the one its
        // last build left: the last job to finish on a tag replaces the volume.
        .runs_on(runners::Runner::Mid.with_cache_tag(vars::WEB_CODEGEN_CACHE_TAG))
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
        .add_step(steps::mount_web_codegen_cache_volume())
        .add_step(steps::reuse_cargo_target())
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
        // Last: its `cargo run -p` builds resolve features per package, so
        // running them earlier would make the steps above recompile.
        .add_step(check_specta_types())
        .add_step(steps::show_sccache_stats())
        .add_step(steps::teardown_nix())
        .add_step(steps::seal_cargo_target())
}

fn biome_check() -> Job {
    gated_web_job("Biome Check")
        .timeout_minutes(20u32)
        .add_step(checkout("Checkout Repo", true))
        .add_step(steps::prepare_blobless_checkout())
        .add_step(steps::mount_nix_cache_volume())
        .add_step(steps::setup_nix_with_seed())
        .add_step(steps::setup_dev_shell())
        .add_step(run_biome())
        .add_step(run_collaboration_biome())
        .add_step(check_platform_rules())
        .add_step(steps::teardown_nix())
}

fn test() -> Job {
    gated_web_job(&format!("Test ({}/6)", matrix::<Num>("shard")))
        .timeout_minutes(20u32)
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
        .timeout_minutes(15u32)
        .runs_on(mid_web_runner())
        .add_step(checkout("Checkout Repo", false))
        .add_step(steps::mount_web_build_check_cache_volume(true))
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
        .timeout_minutes(20u32)
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
        .add_step(run_agent_screen_browser_tests())
        .add_step(steps::teardown_nix())
}

fn cycles() -> Job {
    gated_web_job("Cycles Import Check")
        .timeout_minutes(15u32)
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
        .timeout_minutes(15u32)
        // Match preview/deploy capacity for Vite's chunk-rendering memory peak.
        .runs_on(mid_web_runner())
        .permissions(
            Permissions::default()
                .contents(Level::Read)
                .pull_requests(Level::Write),
        )
        .add_step(checkout("Checkout Repo", false))
        .add_step(steps::mount_web_build_check_cache_volume(false))
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

fn gated_web_job(name: &str) -> Job {
    Job::default()
        .add_needs(PATH_CHECK)
        .cond(PATH_CHECK.outputs.should_run.read().is_set())
        .name(name)
        .runs_on(web_runner())
}

/// `full_history` fetches every commit and tree but no blob up front: `biome
/// --changed` needs the merge base and the icon permanence check a few old
/// blobs, which git then fetches on demand. Fetching full history with every
/// blob took Typecheck and Biome Check about 40 s.
fn checkout(name: &str, full_history: bool) -> Step<Use> {
    let checkout = ActionsCheckout::new(name);
    let checkout = if full_history {
        checkout.fetch_depth(0).filter("blob:none")
    } else {
        checkout
    };
    checkout.step().zizmor_ignore(
        ZizmorRule::Artipacked,
        "check and preview steps run git and scripts from the checkout",
    )
}

/// The filter reads the PR's files from the API and [`detect_schema_changes`]
/// reads trees and a few blobs, so path-check fetches no blobs up front and
/// writes almost no work tree: 18 s became 6 s on the tiny runner.
fn path_check_checkout() -> Step<Use> {
    ActionsCheckout::new("Checkout Repo")
        .filter("blob:none")
        .sparse_checkout(".github")
        .step()
        .zizmor_ignore(
            ZizmorRule::Artipacked,
            "path-check runs git over the PR's commits",
        )
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
        .id(CODEGEN.id())
        .add_env(("CODEGEN_INPUTS", FILTER.outputs.codegen_inputs.read()))
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
    // navigation. `database_grid_changed` covers the database browser
    // tests: the grid, and the timeline with the Gantt it draws.
    // `calendar_details_changed` covers what the event details browser tests
    // render and the query modules their fixture replaces, whose exports the
    // fixture must keep matching. `agent_screen_changed` covers the screen
    // viewer, the pop-out's popover and dialog, and the DM top bar its suite
    // renders, with the modules that fixture replaces.
    DornyPathsFilter::new(
        "Filter changed paths",
            format!(
                "should_run:\n{artifact_paths}  - 'services/lexical-service/**'\n  - 'packages/sdk/**'\n  - 'packages/sdk-docs/**'\n  - 'services/ai-editing-worker/**'\n  - 'services/mcp-chatgpt-worker/**'\n  - 'packages/code-mode-sdk/**'\n  - 'packages/muppet/**'\n  - 'packages/starter-agent/**'\n  - 'tooling/scripts/starter-agent-lock.sh'\n  - 'crates/agent_code_mode/SKILL.md'\n  - '.github/actions/setup-reqs-web/**'\nweb_artifact_changed:\n{artifact_paths}codegen_inputs:\n  - 'apps/web/scripts/generate-api-schema.ts'\n  - 'apps/web/scripts/services.ts'\n  - 'packages/sdk/**'\n  - 'apps/docs/**'\n  - '.github/actions/setup-reqs-web/**'\ni18n_changed:\n  - 'apps/web/src/lib/i18n/**'\n  - 'apps/web/src/lib/core/component/ContextMenu.tsx'\n  - 'apps/web/src/lib/core/constant/settingsTabsConfig.tsx'\n  - 'apps/web/src/components/ui/components/Dropdown.tsx'\n  - 'apps/web/src/features/settings/**'\ndatabase_grid_changed:\n  - 'apps/web/src/features/database/**'\n  - 'apps/web/src/components/gantt/**'\ncalendar_details_changed:\n  - 'apps/web/src/features/calendar-view/**'\n  - 'apps/web/src/features/calendar/**'\n  - 'apps/web/src/lib/queries/calendar/**'\nagent_screen_changed:\n  - 'apps/web/src/features/agent-screen/**'\n  - 'apps/web/src/features/channel/Channel/ChannelDetail.tsx'\n  - 'apps/web/src/features/settings/views/team-agent-dm-status.tsx'\n  - 'apps/web/src/components/priority-collapse/**'\n  - 'apps/web/src/lib/core/context/channels.ts'\n  - 'apps/web/src/features/channel/use-channel-participants.ts'\n  - 'apps/web/src/features/settings/primitives/team-agent-status.ts'\n  - 'apps/web/src/features/channel/Call/use-call.ts'\n  - 'apps/web/src/components/app/GlobalAppState.tsx'\n  - 'apps/web/src/lib/core/context/user.ts'\n  - 'apps/web/src/lib/core/user/displayName.ts'\n  - 'apps/web/src/components/app/split-layout/**'\n  - 'apps/web/src/components/ui/components/Dialog.tsx'\n"
            ),
    )
    .step()
    .id(FILTER.id())
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
        .add_env((
            "SPECTA_BIN_DIR",
            format!("{}/target/debug", github().workspace()),
        ))
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
    with_wasm_pkg_cache(
        Step::new("Build agent-fold WASM for tests")
            .run("just build-agent-fold-wasm")
            .working_directory(xtask_paths::repo_dir!("apps/web"))
            .timeout_minutes(15u32),
    )
}

fn build_natural_time_for_tests() -> Step<Run> {
    with_wasm_pkg_cache(
        Step::new("Build natural-time WASM for tests")
            .run("just build-natural-time-wasm")
            .working_directory(xtask_paths::repo_dir!("apps/web"))
            .timeout_minutes(15u32),
    )
}

/// Reuse unchanged wasm packages from the node's cache volume, then from
/// Namespace's HTTP cache. Both are writable by every PR job, so only PR jobs
/// read them; deploys keep their own (`build_web_app`).
fn with_wasm_pkg_cache(step: Step<Run>) -> Step<Run> {
    step.add_env(("WASM_PKG_CACHE_DIR", vars::WASM_PKG_CACHE_DIR))
        .add_env(("WASM_PKG_HTTP_CACHE", "1"))
}

/// `bun run test` enables Vitest's filesystem module cache; the cache volume
/// keeps it warm across jobs.
fn run_tests() -> Step<Run> {
    Step::new("Test")
        .run(r#"bun run test --shard="${SHARD}/6""#)
        .add_env(("SHARD", matrix::<Num>("shard")))
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
        .if_condition(PATH_CHECK.outputs.i18n_changed.read().is_set())
        .working_directory(xtask_paths::repo_dir!("apps/web"))
}

/// Rows and cells measured under remote presence in Chromium. Only when the
/// database grid changes.
fn run_database_browser_tests() -> Step<Run> {
    Step::new("Database Grid Browser Tests")
        .run("bunx playwright install-deps chromium\njust test-database-browser")
        .if_condition(PATH_CHECK.outputs.database_grid_changed.read().is_set())
        .working_directory(xtask_paths::repo_dir!("apps/web"))
}

/// Event details placement and guest editors in desktop and phone Chromium,
/// over preview adapters instead of a backend. Only when calendar details or
/// the calendar queries the adapters stand in for change.
fn run_calendar_details_browser_tests() -> Step<Run> {
    Step::new("Calendar Event Details Browser Tests")
        .run("bunx playwright install-deps chromium\njust test-calendar-details-browser")
        .if_condition(PATH_CHECK.outputs.calendar_details_changed.read().is_set())
        .working_directory(xtask_paths::repo_dir!("apps/web"))
}

/// The screen viewer's desktop and phone layouts and the agent DM's top bar,
/// in Chromium over a stand-in transport and stubbed queries. Only when the
/// viewer, that top bar, or a module the fixture replaces changes.
fn run_agent_screen_browser_tests() -> Step<Run> {
    Step::new("Agent Screen Browser Tests")
        .run("bunx playwright install-deps chromium\njust test-agent-screen-browser")
        .if_condition(PATH_CHECK.outputs.agent_screen_changed.read().is_set())
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
/// keep it. The wasm package key includes them (`wasm-cache-key.ts`), so a PR
/// build of these three never reuses a deploy's or the reverse; deploys keep
/// their packages in a cache of their own anyway (`build_web_app`).
const PR_WASM_ENV: [(&str, &str); 6] = [
    ("CARGO_PROFILE_FIG_ENGINE_WASM_LTO", "off"),
    ("CARGO_PROFILE_FIG_ENGINE_WASM_CODEGEN_UNITS", "16"),
    ("CARGO_PROFILE_PSD_ENGINE_WASM_LTO", "off"),
    ("CARGO_PROFILE_PSD_ENGINE_WASM_CODEGEN_UNITS", "16"),
    ("CARGO_PROFILE_AI_ENGINE_WASM_LTO", "off"),
    ("CARGO_PROFILE_AI_ENGINE_WASM_CODEGEN_UNITS", "16"),
];

pub(crate) fn with_pr_wasm_env(step: Step<Run>) -> Step<Run> {
    with_wasm_pkg_cache(PR_WASM_ENV.into_iter().fold(step, Step::add_env))
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
