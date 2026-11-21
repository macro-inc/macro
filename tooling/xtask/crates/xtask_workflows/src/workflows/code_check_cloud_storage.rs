//! `cloud storage code check` — cargo fmt/clippy/test for the cloud-storage
//! workspace on pull requests. Generated into `code_check_cloud_storage.yml`.
//!
//! Ported from the hand-written workflow, with two infra changes: the runners
//! moved to Namespace profiles, and compiled objects moved off the S3/local
//! volume backends onto Namespace's official remote sccache (so there are no
//! AWS credentials anywhere).
//!
//! Critical path: `path-check` (no Rust compile on a warm binary cache) →
//! `test`. `check` (fmt + clippy), `build-service-bins`, `doppler-config`, and
//! `graphql-schema-compat` run alongside `test`.

use gh_workflow::expr::typed::{
    Bool, Expr, Flag, JobHandle, JobOutput, StepHandle, StepOutput, Str, env,
};
use gh_workflow::{Container, Env, Event, Job, Port, Run, Step, Workflow, WorkflowCall};
use xtask_paths::RuntimePath;

use crate::workflows::actions::{DenolandSetupDeno, DornyPathsFilter};
use crate::workflows::{
    runners,
    steps::{self, FluentBuilder},
    vars,
};

#[cfg(test)]
mod test;

struct PathCheckOutputs {
    /// Whether the cloud storage checks should run at all.
    should_run: JobOutput<Flag>,
    /// Whether deployment-selection inputs require both Loro guards.
    loro_guards: JobOutput<Flag>,
    /// Whether a change could affect a service's Doppler config contract.
    doppler_candidates: JobOutput<Flag>,
    /// Whether the GraphQL schema or its compat check changed.
    graphql_schema: JobOutput<Flag>,
    /// The nextest package set: `all`, `none`, or package names.
    rust_packages: JobOutput<Str>,
    /// Whether the change needs no tests run.
    skip_tests: JobOutput<Flag>,
    /// Whether the change touches sqlx query data (`.sqlx`).
    query_data: JobOutput<Flag>,
}

const PATH_CHECK: JobHandle<PathCheckOutputs> = JobHandle::new(
    "path-check",
    PathCheckOutputs {
        should_run: JobOutput::new("path-check", "should_run"),
        loro_guards: JobOutput::new("path-check", "loro_guards"),
        doppler_candidates: JobOutput::new("path-check", "doppler_candidates"),
        graphql_schema: JobOutput::new("path-check", "graphql_schema"),
        rust_packages: JobOutput::new("path-check", "rust_packages"),
        skip_tests: JobOutput::new("path-check", "skip_tests"),
        query_data: JobOutput::new("path-check", "query_data"),
    },
);

const CHECK: JobHandle<()> = JobHandle::new("check", ());
const DOPPLER_CONFIG: JobHandle<()> = JobHandle::new("doppler-config", ());
const TEST: JobHandle<()> = JobHandle::new("test", ());
const BUILD_SERVICE_BINS: JobHandle<()> = JobHandle::new("build-service-bins", ());
const GRAPHQL_SCHEMA_COMPAT: JobHandle<()> = JobHandle::new("graphql-schema-compat", ());

struct FilterOutputs {
    /// The `should_run` filter's match.
    should_run: StepOutput<Flag>,
    loro_guards: StepOutput<Flag>,
    /// The `doppler_candidates` filter's match.
    doppler_candidates: StepOutput<Flag>,
    /// The `graphql_schema` filter's match.
    graphql_schema: StepOutput<Flag>,
    /// The `query_data` filter's match.
    query_data: StepOutput<Flag>,
}

const FILTER: StepHandle<FilterOutputs> = StepHandle::new(
    "filter",
    FilterOutputs {
        should_run: StepOutput::new("filter", "should_run"),
        loro_guards: StepOutput::new("filter", "loro_guards"),
        doppler_candidates: StepOutput::new("filter", "doppler_candidates"),
        graphql_schema: StepOutput::new("filter", "graphql_schema"),
        query_data: StepOutput::new("filter", "query_data"),
    },
);

struct NextestFilterOutputs {
    /// The package set nextest and clippy run on.
    rust_packages: StepOutput<Str>,
    /// Whether no tests need to run.
    skip_tests: StepOutput<Flag>,
}

const NEXTEST_FILTER: StepHandle<NextestFilterOutputs> = StepHandle::new(
    "nextest-filter",
    NextestFilterOutputs {
        rust_packages: StepOutput::new("nextest-filter", "rust_packages"),
        skip_tests: StepOutput::new("nextest-filter", "skip_tests"),
    },
);

struct DopplerBinsOutputs {
    /// The Doppler config binaries the change affects.
    doppler_config_bins: StepOutput<Str>,
}

const DOPPLER_BINS: StepHandle<DopplerBinsOutputs> = StepHandle::new(
    "doppler-bins",
    DopplerBinsOutputs {
        doppler_config_bins: StepOutput::new("doppler-bins", "doppler_config_bins"),
    },
);

/// Build the workflow.
pub fn code_check_cloud_storage() -> Workflow {
    Workflow::new("cloud storage code check")
        .on(Event::default().workflow_call(WorkflowCall::default()))
        .map(vars::with_global_env)
        .add_job(PATH_CHECK, path_check())
        .add_job(CHECK, check())
        .add_job(DOPPLER_CONFIG, doppler_config())
        .add_job(TEST, test())
        .add_job(BUILD_SERVICE_BINS, build_service_bins())
        .add_job(GRAPHQL_SCHEMA_COMPAT, graphql_schema_compat())
}

const CHECK_TIMEOUT_MINUTES: u32 = 20;
const LORO_CHECK_TIMEOUT_MINUTES: u32 = 30;

// These are selection-defining inputs and every literal caller namespace the
// checker discovers. YAML discovery is structural, so filenames cannot narrow it.
const LORO_GUARD_PATHS: &[&str] = &[
    "vendor/loro-editor/**",
    "Cargo.toml",
    "Cargo.lock",
    "**/Cargo.toml",
    "rust-toolchain.toml",
    ".cargo/**",
    ".config/hakari.toml",
    "crates/workspace-hack/**",
    "tooling/xtask/**",
    "**/*.sh",
    "justfile",
    "**/justfile",
    "**/*.yml",
    "**/*.yaml",
    "**/*Dockerfile*",
    "nix/**",
    "flake.nix",
    "flake.lock",
    ".github/services-config.json",
    ".github/workspace-dep-closures.json",
    "infra/stacks/**/*.ts",
    "infra/packages/service/**",
];

/// Where `path-check` keeps the release `xtask_nextest_filter` binary (keyed by
/// its source trees and `Cargo.lock`) and the target dir that builds it.
const FILTER_CACHE_DIR: RuntimePath<'static> =
    xtask_paths::runtime_path!("/home/runner/.cache/macro-nextest-filter");

/// Decide whether the rest of the workflow runs and compute the nextest
/// filter. Deliberately light: no Nix, and a cached release binary for the filter.
/// The sccache step supplies only that cache's credentials; nothing compiles through
/// it here.
fn path_check() -> Job {
    Job::default()
        .timeout_minutes(10u32)
        .runs_on(runners::Runner::Small.with_cache_tag(vars::CI_CACHE_TAG))
        .add_output(
            PATH_CHECK.outputs.should_run.name(),
            FILTER.outputs.should_run.read(),
        )
        .add_output(
            PATH_CHECK.outputs.loro_guards.name(),
            FILTER.outputs.loro_guards.read(),
        )
        .add_output(
            PATH_CHECK.outputs.doppler_candidates.name(),
            FILTER.outputs.doppler_candidates.read(),
        )
        .add_output(
            PATH_CHECK.outputs.query_data.name(),
            FILTER.outputs.query_data.read(),
        )
        .add_output(
            PATH_CHECK.outputs.graphql_schema.name(),
            FILTER.outputs.graphql_schema.read(),
        )
        .add_output(
            PATH_CHECK.outputs.rust_packages.name(),
            NEXTEST_FILTER.outputs.rust_packages.read(),
        )
        .add_output(
            PATH_CHECK.outputs.skip_tests.name(),
            NEXTEST_FILTER.outputs.skip_tests.read(),
        )
        // PR merge commits need both parents for `git merge-base`; fetching
        // the entire repo (every branch) is not required.
        .add_step(steps::checkout_action(false, false).fetch_depth(2))
        .add_step(steps::setup_rust_light())
        .add_step(paths_filter())
        .add_step(compute_changed_files().if_condition(FILTER.outputs.should_run.read().is_set()))
        .add_step(
            steps::mount_nextest_filter_cache(FILTER_CACHE_DIR).if_condition(
                FILTER
                    .outputs
                    .should_run
                    .read()
                    .is_set()
                    .and(steps::trusted_namespace_sccache_context()),
            ),
        )
        .add_step(steps::configure_namespace_sccache(vars::CI_SCCACHE_NAME))
        .add_step(compute_nextest_filter())
}

/// Why a job that keeps its cargo `target` rebuilds every workspace crate
/// anyway (`CARGO_TARGET_REBUILD_ALL`, `scripts/cargo_target_reuse.ts`): sqlx
/// reads `.sqlx` data without telling cargo, so a kept unit can outlive the
/// data its queries need when the pull request removes it.
fn rebuild_all_reason() -> Expr<Str> {
    PATH_CHECK
        .outputs
        .query_data
        .read()
        .is_set()
        .then_else("the pull request changes query data", "")
}

/// fmt + unused dependencies + clippy.
fn check() -> Job {
    steps::gated_job(&PATH_CHECK.outputs.should_run)
        .timeout_minutes(PATH_CHECK.outputs.loro_guards.read().is_set().then_else(
            i64::from(LORO_CHECK_TIMEOUT_MINUTES),
            i64::from(CHECK_TIMEOUT_MINUTES),
        ))
        .runs_on(runners::Runner::Large.with_cache_tag(vars::CI_CACHE_TAG))
        .add_env(("CARGO_TARGET_REBUILD_ALL", rebuild_all_reason()))
        .map(with_check_env)
        .add_step(steps::checkout(false, false))
        .add_step(steps::mount_cache_volume())
        .add_step(steps::reuse_cargo_target())
        .add_step(steps::setup_nix_with_seed())
        .add_step(steps::setup_dev_shell().timeout_minutes(vars::DEV_SHELL_TIMEOUT_MINUTES))
        .add_step(steps::configure_namespace_sccache(vars::CI_SCCACHE_NAME))
        .add_step(
            Step::new("Check vendored Loro against upstream")
                .run("just check-loro-editor-vendor")
                .if_condition(PATH_CHECK.outputs.loro_guards.read().is_set()),
        )
        .add_step(
            Step::new("Check deployed server Loro feature isolation")
                .run("just check-loro-native-editor-features")
                .if_condition(PATH_CHECK.outputs.loro_guards.read().is_set()),
        )
        .add_step(steps::code_mode_assets())
        .add_step(cargo_fmt())
        .add_step(cargo_shear())
        .add_step(cargo_clippy())
        .add_step(steps::show_sccache_stats())
        .add_step(steps::teardown_nix())
        .add_step(steps::seal_cargo_target())
}

/// The env the clippy-side jobs share, so their sccache keys stay identical.
fn with_check_env(job: Job) -> Job {
    job.add_env((
        "RUSTFLAGS",
        "-Dwarnings -Dclippy::disallowed_methods -C link-arg=-fuse-ld=mold",
    ))
    .add_env(("RUSTDOCFLAGS", "-Dwarnings"))
    .add_env(("SQLX_OFFLINE", "true"))
}

/// Live Doppler config-contract check for services whose config may have
/// changed. Runs beside `check`/`test` instead of inside `path-check`, where
/// computing the bin list compiled an xtask from scratch on every PR. A cheap
/// path filter gates it; the xtask then picks the exact binaries.
fn doppler_config() -> Job {
    steps::gated_job(&PATH_CHECK.outputs.should_run)
        .timeout_minutes(20u32)
        .cond(
            PATH_CHECK
                .outputs
                .should_run
                .read()
                .is_set()
                .and(PATH_CHECK.outputs.doppler_candidates.read().is_set()),
        )
        .runs_on(runners::Runner::RustCi.with_cache_tag(vars::CI_CACHE_TAG))
        .add_env(("CARGO_TARGET_REBUILD_ALL", rebuild_all_reason()))
        .map(with_check_env)
        .add_step(steps::checkout_action(false, false).fetch_depth(2))
        // Before the dev shell: its LD_LIBRARY_PATH points the runner's
        // git-remote-https at Nix's glibc, which aborts `git fetch`.
        .add_step(compute_changed_files())
        .add_step(steps::mount_cache_volume())
        .add_step(steps::reuse_cargo_target())
        .add_step(steps::setup_nix_with_seed())
        .add_step(steps::setup_dev_shell().timeout_minutes(vars::DEV_SHELL_TIMEOUT_MINUTES))
        .add_step(steps::configure_namespace_sccache(vars::CI_SCCACHE_NAME))
        .add_step(steps::code_mode_assets())
        .add_step(compute_doppler_bins())
        .add_step(validate_doppler_configs())
        .add_step(steps::show_sccache_stats())
        .add_step(steps::teardown_nix())
        .add_step(steps::seal_cargo_target())
}

/// Fails when `static_assets/schema.graphql` drops or narrows something
/// clients built against the base branch still send. The checkout is the PR
/// merge commit, so its first parent is the base branch tip.
fn graphql_schema_compat() -> Job {
    steps::gated_job(&PATH_CHECK.outputs.should_run)
        .timeout_minutes(15u32)
        .cond(
            PATH_CHECK.outputs.should_run.read()
                .is_set()
                .and(PATH_CHECK.outputs.graphql_schema.read().is_set()),
        )
        .runs_on(runners::Runner::Small.to_string())
        .add_step(steps::checkout_action(false, false).fetch_depth(2))
        .add_step(steps::setup_rust_light())
        .add_step(
            Step::new("Check GraphQL schema compatibility").run(
                "cargo run --locked --manifest-path tooling/xtask/Cargo.toml -- graphql-schema-compat --base HEAD^1",
            ),
        )
}

/// cargo nextest against postgres + redis service containers. Skipped when
/// the path filter selected no Rust packages (Nix-only / unmapped files) or
/// when `skip_tests` is set (`.sqlx`-only diffs still clippy the snapshot).
fn test() -> Job {
    steps::gated_job(&PATH_CHECK.outputs.should_run)
        .timeout_minutes(20u32)
        .cond(
            PATH_CHECK
                .outputs
                .should_run
                .read()
                .is_set()
                .and(PATH_CHECK.outputs.rust_packages.read().ne("none"))
                .and(PATH_CHECK.outputs.skip_tests.read().is_unset()),
        )
        .runs_on(runners::Runner::Large.with_cache_tag(vars::CI_CACHE_TAG))
        .add_env(("CARGO_TARGET_REBUILD_ALL", rebuild_all_reason()))
        .add_env(("RUST_PACKAGES", PATH_CHECK.outputs.rust_packages.read()))
        .add_env(("NEXTEST_TEST_THREADS", vars::NEXTEST_TEST_THREADS))
        .add_env(("REDIS_URI", "redis://127.0.0.1:6379"))
        .map(with_test_compile_env)
        // The default 10-minute idle timeout can stop the server during long
        // link or test phases, which resets the stats reported at the end.
        .add_env(("SCCACHE_IDLE_TIMEOUT", "0"))
        .add_service("postgres", postgres_service())
        .add_service("redis", redis_service())
        .add_step(steps::checkout(false, false))
        .add_step(steps::start_opensearch().if_condition(runs_opensearch_tests()))
        .add_step(steps::mount_cache_volume())
        .add_step(steps::reuse_cargo_target())
        .add_step(steps::setup_nix_with_seed())
        .add_step(steps::setup_dev_shell().timeout_minutes(vars::DEV_SHELL_TIMEOUT_MINUTES))
        .add_step(steps::configure_namespace_sccache(vars::CI_SCCACHE_NAME))
        .add_step(steps::start_sccache_server())
        .add_step(steps::code_mode_assets())
        .add_step(configure_postgres())
        // The lexical_loro differential tests run the real JS mirror through Bun.
        .add_step(steps::install_workspace_js_dependencies())
        // The lexical_conformance and document_session_ffi replays export HTML through jsdom.
        .add_step(steps::install_conformance_dependencies())
        .add_step(prepare_tests())
        .add_step(run_tests())
        .add_step(setup_execution_runtime())
        .add_step(test_execution_runtime())
        .add_step(steps::create_search_indices().if_condition(runs_opensearch_tests()))
        .add_step(test_content_search())
        .add_step(steps::show_sccache_stats())
        .add_step(steps::teardown_nix())
        .add_step(steps::seal_cargo_target())
}

/// The selections that include `opensearch_client`, whose content search
/// test needs an OpenSearch with the search indices.
fn runs_opensearch_tests() -> Expr<Bool> {
    env("RUST_PACKAGES")
        .eq("all")
        .or(env("RUST_PACKAGES").contains("opensearch_client"))
}

/// Run content search against a real OpenSearch and compare what it returns
/// with what its matching rules select (`crates/opensearch_client/tests/content_search.rs`).
fn test_content_search() -> Step<Run> {
    Step::new("Test content search against OpenSearch")
        .run(include_str!("scripts/run_tests.sh"))
        .add_env(("NEXTEST_RUN_OPENSEARCH_TESTS", "true"))
        .add_env(("SEARCH_TEST_OPENSEARCH_URL", steps::SEARCH_OPENSEARCH_URL))
        .if_condition(runs_opensearch_tests())
}

/// The env the jobs that compile for `test` share, so their sccache keys stay
/// identical.
pub(crate) fn with_test_compile_env(job: Job) -> Job {
    // Debug info is most of what test builds write and link. Panic locations
    // don't depend on it; only backtrace frames lose their file and line.
    job.add_env(("CARGO_PROFILE_DEV_DEBUG", "0"))
        .add_env(("CARGO_PROFILE_TEST_DEBUG", "0"))
        .add_env(("RUSTFLAGS", "-Dwarnings -C link-arg=-fuse-ld=mold"))
}

/// Build the real binaries of the services whose `run` bodies only a real build
/// compiles. The script picks them from the selected packages; this gate only
/// avoids a dev shell when none can match.
fn build_service_bins() -> Job {
    steps::gated_job(&PATH_CHECK.outputs.should_run)
        .timeout_minutes(20u32)
        .cond(build_service_bins_condition())
        .runs_on(runners::Runner::Large.with_cache_tag(vars::CI_CACHE_TAG))
        .add_env(("CARGO_TARGET_REBUILD_ALL", rebuild_all_reason()))
        .add_env(("RUST_PACKAGES", PATH_CHECK.outputs.rust_packages.read()))
        .map(with_test_compile_env)
        .add_env(("SQLX_OFFLINE", "true"))
        .add_step(steps::checkout(false, false))
        .add_step(steps::mount_cache_volume())
        .add_step(steps::reuse_cargo_target())
        .add_step(steps::setup_nix())
        .add_step(steps::setup_dev_shell().timeout_minutes(vars::DEV_SHELL_TIMEOUT_MINUTES))
        .add_step(steps::configure_namespace_sccache(vars::CI_SCCACHE_NAME))
        .add_step(steps::code_mode_assets())
        .add_step(
            Step::new("build service binaries").run(include_str!("scripts/build_service_bins.sh")),
        )
        .add_step(steps::show_sccache_stats())
        .add_step(steps::teardown_nix())
        .add_step(steps::seal_cargo_target())
}

fn build_service_bins_condition() -> Expr<Bool> {
    let rust_packages = || PATH_CHECK.outputs.rust_packages.read();
    PATH_CHECK
        .outputs
        .should_run
        .read()
        .is_set()
        .and(PATH_CHECK.outputs.skip_tests.read().is_unset())
        .and(
            rust_packages()
                .eq("all")
                .or(rust_packages().contains("document_storage_service"))
                .or(rust_packages().contains("email_service"))
                .or(rust_packages().contains("authentication_service")),
        )
}

/// Whether the selected packages run code through the pinned Deno runtime.
fn tests_execution_runtime() -> Expr<Bool> {
    let rust_packages = || env("RUST_PACKAGES");
    rust_packages()
        .eq("all")
        .or(rust_packages().contains("code_execution"))
        .or(rust_packages().contains("agent_code_mode"))
        .or(rust_packages().contains("agent_harness_service"))
}

/// Install the same pinned runtime shipped in the agent harness container.
fn setup_execution_runtime() -> Step<gh_workflow::Use> {
    DenolandSetupDeno::new("Set up code execution runtime")
        .deno_version("2.9.6")
        .step()
        .if_condition(tests_execution_runtime())
}

/// Exercise the real permission boundary, authenticated SDK execution, and
/// routine code (the step contract, starters and examples) against the SDK
/// in CI.
fn test_execution_runtime() -> Step<Run> {
    Step::new("Test Deno sandbox and authenticated SDK execution")
        .run(include_str!("scripts/run_tests.sh"))
        .add_env(("NEXTEST_RUN_DENO_TESTS", "true"))
        .if_condition(tests_execution_runtime())
}

// --- workflow-specific steps -------------------------------------------------

/// Detect whether cloud-storage-relevant paths changed, and whether any
/// change could affect a service's Doppler config contract (a superset of
/// what `xtask doppler-bins` checks, so the gate never hides a bin).
fn paths_filter() -> Step<gh_workflow::Use> {
    let mut should_run = vec![
        "Cargo.toml",
        "Cargo.lock",
        "Cross.toml",
        "clippy.toml",
        "deny.toml",
        "rust-toolchain.toml",
        ".cargo/**",
        ".config/**",
        ".sqlx/**",
        "crates/**",
        "services/**",
        "tooling/xtask/**",
        "static_assets/**",
        "nix/**",
        "nix-support/node_modules*",
        "flake.nix",
        "flake.lock",
        "bun.lock",
        "packages/sdk/**",
        "packages/sdk-docs/**",
        "packages/code-mode-sdk/**",
        ".github/actions/setup-nix/**",
        ".github/actions/setup-nix-dev-shell/**",
        ".github/actions/teardown-nix/**",
        ".github/actions/setup-sccache/**",
        ".github/services-config.json",
        ".github/workflows/code_check_cloud_storage.yml",
    ];
    for path in LORO_GUARD_PATHS {
        if !should_run.contains(path) {
            should_run.push(path);
        }
    }
    let path_list = |paths: &[&str]| {
        paths
            .iter()
            .map(|path| format!("  - '{path}'"))
            .collect::<Vec<_>>()
            .join("\n")
    };
    let filters = format!(
        "should_run:\n{}\nloro_guards:\n{}\n{}",
        path_list(&should_run),
        path_list(LORO_GUARD_PATHS),
        indoc::indoc! {r#"
        doppler_candidates:
          - '.github/services-config.json'
          - '**/src/config.rs'
          - '**/src/doppler_config.rs'
          - '**/Cargo.toml'
          - 'tooling/xtask/crates/xtask_doppler_bins/**'
          - .github/workflows/code_check_cloud_storage.yml
        graphql_schema:
          - 'static_assets/schema.graphql'
          - 'tooling/xtask/crates/xtask_graphql_schema_compat/**'
          - .github/workflows/code_check_cloud_storage.yml
        query_data:
          - '**/.sqlx/**'
    "#}
    );
    DornyPathsFilter::new("Filter changed paths", filters)
        .step()
        .id(FILTER.id())
}

/// Compute the changed-file set and write it to `/tmp/changed-files`. Stacked
/// PRs whose merge commit sits on another branch get their history deepened
/// until it reaches the base branch. If no merge-base turns up, we leave the
/// list empty, which makes downstream steps fall back to "everything": run all
/// tests, validate no Doppler bins.
fn compute_changed_files() -> Step<Run> {
    Step::new("compute changed files")
        .run(include_str!("scripts/compute_changed_files.sh"))
        .shell("bash")
}

/// Determine which services' Doppler config-validation binaries are affected by
/// the changed files, via the `xtask doppler-bins` subcommand.
fn compute_doppler_bins() -> Step<Run> {
    Step::new("compute affected Doppler config bins")
        .run(include_str!("scripts/compute_doppler_bins.sh"))
        .id(DOPPLER_BINS.id())
        .shell("bash")
}

/// Compute the cargo-nextest / clippy package set from the changed files, via
/// the `xtask nextest-filter` subcommand.
/// Toolchain and cargo config changes short-circuit to the full suite; root
/// `Cargo.toml` edits run the full suite unless they only touch workspace
/// members or dependencies; unmapped files (a top-level JSON, a Nix shell
/// tweak) select no packages.
fn compute_nextest_filter() -> Step<Run> {
    Step::new("compute nextest package filter")
        .run(include_str!("scripts/compute_nextest_filter.sh"))
        .id(NEXTEST_FILTER.id())
        .if_condition(FILTER.outputs.should_run.read().is_set())
        .add_env(("FILTER_CACHE_DIR", FILTER_CACHE_DIR.as_str()))
        .shell("bash")
}

/// Build and run the Doppler config binaries affected by this PR. Namespace's
/// remote sccache needs no AWS credentials; only the assertion that
/// `RUSTC_WRAPPER` is wired stays.
fn validate_doppler_configs() -> Step<Run> {
    Step::new("validate Doppler configs")
        .run(include_str!("scripts/validate_doppler_configs.sh"))
        .if_condition(DOPPLER_BINS.outputs.doppler_config_bins.read().ne(""))
        .add_env((
            "DOPPLER_CONFIG_BINS",
            DOPPLER_BINS.outputs.doppler_config_bins.read(),
        ))
        .add_env(("DOPPLER_TOKEN", vars::DOPPLER_TOKEN))
}

/// `cargo fmt --check`.
fn cargo_fmt() -> Step<Run> {
    Step::new("fmt").run("cargo fmt --check")
}

/// `cargo shear`: rejects unused dependencies from the sources alone, without
/// compiling. A dependency needed only for a side effect goes in its
/// manifest's `[package.metadata.cargo-shear] ignored`.
fn cargo_shear() -> Step<Run> {
    Step::new("unused dependencies").run("cargo shear --format github")
}

/// `cargo clippy`, scoped to the same package set as nextest.
fn cargo_clippy() -> Step<Run> {
    Step::new("clippy")
        .run(include_str!("scripts/cargo_clippy.sh"))
        .add_env(("RUST_PACKAGES", PATH_CHECK.outputs.rust_packages.read()))
}

/// Match production's PostgreSQL major version so CI rejects incompatible migrations.
///
/// Its data lives in shared memory because `#[sqlx::test]` creates and drops a
/// database per test, and those file operations are what limit the test run on
/// the runner's disk. A bind mount, not `--tmpfs`: `configure_postgres` restarts
/// the container, and a restart empties a `--tmpfs` mount.
pub(crate) fn postgres_service() -> Container {
    Container::default()
        .image("pgvector/pgvector:pg14")
        .env(
            Env::new("POSTGRES_USER", "user")
                .add("POSTGRES_PASSWORD", "password")
                .add("POSTGRES_DB", "macrodb"),
        )
        .ports(vec![Port::Name("5432:5432".to_string())])
        .options(
            "--health-cmd pg_isready --health-interval 1s --health-start-period 30s \
             --health-timeout 5s --health-retries 5 --shm-size 1g \
             -v /dev/shm/pgdata:/var/lib/postgresql/data",
        )
}

/// redis service container.
pub(crate) fn redis_service() -> Container {
    Container::default()
        .image("redis:7")
        .ports(vec![Port::Name("6379:6379".to_string())])
        .options(
            "--health-cmd \"redis-cli ping\" --health-interval 1s --health-start-period 30s \
             --health-timeout 5s --health-retries 5",
        )
}

/// Tune the postgres service container for fast concurrent tests.
pub(crate) fn configure_postgres() -> Step<Run> {
    Step::new("configure postgres for concurrent tests")
        .run(include_str!("scripts/configure_postgres.sh"))
}

/// Set up test env files and databases. The pre-migrated template1 spares each
/// `#[sqlx::test]` database from replaying every migration. Between them,
/// [`DATE_LIVE_QUERY_CRATES`].
fn prepare_tests() -> Step<Run> {
    Step::new("prepare tests").run(format!(
        "just setup_test_envs\n{DATE_LIVE_QUERY_CRATES}\njust initialize_dbs\njust setup_test_template"
    ))
}

/// A crate whose `.env` gives sqlx the test database checks its queries
/// against that schema when it compiles, which cargo doesn't track: a kept unit
/// was checked against the schema of whichever run built it, or against `.sqlx`
/// data when an offline job did. Dating these crates' files now rebuilds them,
/// and their dependents, against this run's migrations. The reuse record keeps
/// its times, so other jobs still reuse what this job builds.
const DATE_LIVE_QUERY_CRATES: &str = r#"dated=0
for env in $(find crates services -name .env -not -path '*/node_modules/*'); do
  if grep -q '^DATABASE_URL=' "$env"; then
    git ls-files -z -- "$(dirname "$env")" | xargs -0 -r touch -c -h
    dated=$((dated + 1))
  fi
done
echo "Rebuilding the $dated crates that check queries against the test database"
[ "$dated" -gt 0 ]"#;

/// Run the test suite (no AWS credentials; sccache uses Namespace's remote cache).
fn run_tests() -> Step<Run> {
    Step::new("run tests").run(include_str!("scripts/run_tests.sh"))
}
