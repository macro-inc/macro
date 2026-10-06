//! `cloud storage code check` — cargo fmt/clippy/test for the cloud-storage
//! workspace on pull requests. Generated into `code-check-cloud-storage.yml`.
//!
//! Ported from the hand-written workflow, with two infra changes: the runners
//! moved to Namespace profiles, and compiled objects moved off the S3/local
//! volume backends onto Namespace's official remote sccache (so there are no
//! AWS credentials anywhere).
//!
//! Critical path: `path-check` (no Rust compile on a warm binary cache) →
//! `test`. `check` (fmt + clippy) and `doppler-config` run alongside `test`.

use gh_workflow::{
    Container, Env, Event, Expression, Job, Port, PullRequest, PullRequestType, Run, Step, Workflow,
};
use xtask_paths::RuntimePath;

use crate::workflows::{
    runners,
    steps::{self, FluentBuilder},
    vars,
};

#[cfg(test)]
mod test;

/// Build the workflow.
pub fn code_check_cloud_storage() -> Workflow {
    Workflow::new("cloud storage code check")
        .on(Event::default().pull_request(
            PullRequest::default()
                .add_branch("main")
                .add_type(PullRequestType::Opened)
                .add_type(PullRequestType::Synchronize)
                .add_type(PullRequestType::Reopened)
                .add_type(PullRequestType::ReadyForReview),
        ))
        .map(vars::with_global_env)
        .concurrency(vars::concurrency("code-check-cloud-storage"))
        .add_job("path-check", path_check())
        .add_job("check", check())
        .add_job("doppler-config", doppler_config())
        .add_job("test", test())
        .add_job("status-check", status_check())
}

/// Same-repo PRs only: the binary cache below is shared, so an untrusted fork
/// must not be able to plant a binary under a key a later PR would execute.
const TRUSTED_CONTEXT: &str = steps::TRUSTED_NAMESPACE_SCCACHE_CONTEXT;

/// Where `path-check` keeps the release `xtask_nextest_filter` binary (keyed by
/// its source trees and `Cargo.lock`) and the target dir that builds it.
const FILTER_CACHE_DIR: RuntimePath<'static> =
    xtask_paths::runtime_path!("/home/runner/.cache/macro-nextest-filter");

/// Decide whether the rest of the workflow runs and compute the nextest
/// filter. Deliberately light: no Nix, no sccache, and a cached release
/// binary for the filter.
fn path_check() -> Job {
    Job::default()
        .runs_on(runners::Runner::Small.to_string())
        .add_output("should_run", "${{ steps.filter.outputs.should_run }}")
        .add_output(
            "doppler_candidates",
            "${{ steps.filter.outputs.doppler_candidates }}",
        )
        .add_output(
            "rust_packages",
            "${{ steps.nextest-filter.outputs.rust_packages }}",
        )
        .add_output(
            "skip_tests",
            "${{ steps.nextest-filter.outputs.skip_tests }}",
        )
        // PR merge commits need both parents for `git merge-base`; fetching
        // the entire repo (every branch) is not required.
        .add_step(steps::checkout(false, false).add_with(("fetch-depth", 2)))
        .add_step(steps::setup_rust_light())
        .add_step(paths_filter())
        .add_step(
            compute_changed_files()
                .if_condition(Expression::new("steps.filter.outputs.should_run == 'true'")),
        )
        .add_step(
            steps::mount_path_cache_volume("Mount nextest-filter binary cache", FILTER_CACHE_DIR)
                .if_condition(Expression::new(format!(
                    "steps.filter.outputs.should_run == 'true' && ({TRUSTED_CONTEXT})"
                ))),
        )
        .add_step(compute_nextest_filter())
}

/// fmt + clippy.
fn check() -> Job {
    steps::gated_job()
        .runs_on(runners::Runner::RustCi.with_cache_tag(vars::CI_CACHE_TAG))
        .map(with_check_env)
        .add_step(steps::checkout(false, false))
        .add_step(steps::mount_cache_volume())
        .add_step(steps::setup_nix())
        .add_step(steps::setup_dev_shell())
        .add_step(steps::configure_namespace_sccache(vars::CI_SCCACHE_NAME))
        .add_step(cargo_fmt())
        .add_step(cargo_clippy())
        .add_step(steps::show_sccache_stats())
        .add_step(steps::teardown_nix())
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
    steps::gated_job()
        .cond(Expression::new(
            "needs.path-check.outputs.should_run == 'true' && github.event.pull_request.draft == false && needs.path-check.outputs.doppler_candidates == 'true'",
        ))
        .runs_on(runners::Runner::RustCi.with_cache_tag(vars::CI_CACHE_TAG))
        .map(with_check_env)
        .add_step(steps::checkout(false, false).add_with(("fetch-depth", 2)))
        // Before the dev shell: its LD_LIBRARY_PATH points the runner's
        // git-remote-https at Nix's glibc, which aborts `git fetch`.
        .add_step(compute_changed_files())
        .add_step(steps::mount_cache_volume())
        .add_step(steps::setup_nix())
        .add_step(steps::setup_dev_shell())
        .add_step(steps::configure_namespace_sccache(vars::CI_SCCACHE_NAME))
        .add_step(compute_doppler_bins())
        .add_step(validate_doppler_configs())
        .add_step(steps::show_sccache_stats())
        .add_step(steps::teardown_nix())
}

/// cargo nextest against postgres + redis service containers. Skipped when
/// the path filter selected no Rust packages (Nix-only / unmapped files) or
/// when `skip_tests` is set (`.sqlx`-only diffs still clippy the snapshot).
fn test() -> Job {
    steps::gated_job()
        .cond(Expression::new(
            "needs.path-check.outputs.should_run == 'true' && github.event.pull_request.draft == false && needs.path-check.outputs.rust_packages != 'none' && needs.path-check.outputs.skip_tests != 'true'",
        ))
        .runs_on(runners::Runner::RustCi.with_cache_tag(vars::CI_CACHE_TAG))
        .add_env((
            "RUST_PACKAGES",
            "${{ needs.path-check.outputs.rust_packages }}",
        ))
        .add_env(("NEXTEST_TEST_THREADS", vars::NEXTEST_TEST_THREADS))
        .add_env(("RUSTFLAGS", "-Dwarnings -C link-arg=-fuse-ld=mold"))
        // The default 10-minute idle timeout can stop the server during long
        // link or test phases, which resets the stats reported at the end.
        .add_env(("SCCACHE_IDLE_TIMEOUT", "0"))
        .add_service("postgres", postgres_service())
        .add_service("redis", redis_service())
        .add_step(steps::checkout(false, false))
        .add_step(steps::mount_cache_volume())
        .add_step(steps::setup_nix())
        .add_step(steps::setup_dev_shell())
        .add_step(steps::configure_namespace_sccache(vars::CI_SCCACHE_NAME))
        .add_step(steps::start_sccache_server())
        .add_step(configure_postgres())
        .add_step(prepare_tests())
        .add_step(run_tests())
        .add_step(steps::show_sccache_stats())
        .add_step(steps::teardown_nix())
}

/// Always-run collector used as the required status check. Its name must stay
/// stable — branch protection references it.
fn status_check() -> Job {
    Job::default()
        .name("Cloud Storage Status Check")
        .runs_on(runners::Runner::Small.to_string())
        .cond(Expression::new("always()"))
        .needs(vec![
            "path-check".to_string(),
            "check".to_string(),
            "doppler-config".to_string(),
            "test".to_string(),
        ])
        .add_step(check_job_results())
}

// --- workflow-specific steps -------------------------------------------------

/// Detect whether cloud-storage-relevant paths changed, and whether any
/// change could affect a service's Doppler config contract (a superset of
/// what `xtask doppler-bins` checks, so the gate never hides a bin).
fn paths_filter() -> Step<gh_workflow::Use> {
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
                  - 'Cargo.toml'
                  - 'Cargo.lock'
                  - 'Cross.toml'
                  - 'clippy.toml'
                  - 'deny.toml'
                  - 'rust-toolchain.toml'
                  - '.cargo/**'
                  - '.config/**'
                  - '.sqlx/**'
                  - 'crates/**'
                  - 'services/**'
                  - 'tooling/xtask/**'
                  - 'static_assets/**'
                  - 'nix/**'
                  - 'flake.nix'
                  - 'flake.lock'
                  - '.github/actions/setup-nix/**'
                  - '.github/actions/setup-nix-dev-shell/**'
                  - '.github/actions/teardown-nix/**'
                  - '.github/actions/setup-sccache/**'
                  - '.github/services-config.json'
                  - .github/workflows/code_check_cloud_storage.yml
                doppler_candidates:
                  - '.github/services-config.json'
                  - '**/src/config.rs'
                  - '**/src/doppler_config.rs'
                  - '**/Cargo.toml'
                  - 'tooling/xtask/crates/xtask_doppler_bins/**'
                  - .github/workflows/code_check_cloud_storage.yml
            "#},
        ))
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
        .id("doppler-bins")
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
        .id("nextest-filter")
        .if_condition(Expression::new("steps.filter.outputs.should_run == 'true'"))
        .add_env(("FILTER_CACHE_DIR", FILTER_CACHE_DIR.as_str()))
        .shell("bash")
}

/// Build and run the Doppler config binaries affected by this PR. Namespace's
/// remote sccache needs no AWS credentials; only the assertion that
/// `RUSTC_WRAPPER` is wired stays.
fn validate_doppler_configs() -> Step<Run> {
    Step::new("validate Doppler configs")
        .run(include_str!("scripts/validate_doppler_configs.sh"))
        .if_condition(Expression::new(
            "steps.doppler-bins.outputs.doppler_config_bins != ''",
        ))
        .add_env((
            "DOPPLER_CONFIG_BINS",
            "${{ steps.doppler-bins.outputs.doppler_config_bins }}",
        ))
        .add_env(("DOPPLER_TOKEN", vars::DOPPLER_TOKEN))
}

/// `cargo fmt --check`.
fn cargo_fmt() -> Step<Run> {
    Step::new("fmt").run("cargo fmt --check")
}

/// `cargo clippy`, scoped to the same package set as nextest.
fn cargo_clippy() -> Step<Run> {
    Step::new("clippy")
        .run(include_str!("scripts/cargo_clippy.sh"))
        .add_env((
            "RUST_PACKAGES",
            "${{ needs.path-check.outputs.rust_packages }}",
        ))
}

/// pgvector service container, tuned env preserved.
fn postgres_service() -> Container {
    Container::default()
        .image("pgvector/pgvector:pg18")
        .env(
            Env::new("POSTGRES_USER", "user")
                .add("POSTGRES_PASSWORD", "password")
                .add("POSTGRES_DB", "macrodb"),
        )
        .ports(vec![Port::Name("5432:5432".to_string())])
        .options(
            "--health-cmd pg_isready --health-interval 10s --health-timeout 5s \
             --health-retries 5 --shm-size 1g",
        )
}

/// redis service container.
fn redis_service() -> Container {
    Container::default()
        .image("redis:7")
        .ports(vec![Port::Name("6379:6379".to_string())])
        .options(
            "--health-cmd \"redis-cli ping\" --health-interval 10s \
             --health-timeout 5s --health-retries 5",
        )
}

/// Tune the postgres service container for fast concurrent tests.
fn configure_postgres() -> Step<Run> {
    Step::new("configure postgres for concurrent tests")
        .run(include_str!("scripts/configure_postgres.sh"))
}

/// Set up test env files and databases. The pre-migrated template1 spares each
/// `#[sqlx::test]` database from replaying every migration.
fn prepare_tests() -> Step<Run> {
    Step::new("prepare tests")
        .run("just setup_test_envs && just initialize_dbs && just setup_test_template")
}

/// Run the test suite (no AWS credentials; sccache uses Namespace's remote cache).
fn run_tests() -> Step<Run> {
    Step::new("run tests").run(include_str!("scripts/run_tests.sh"))
}

/// Aggregate the upstream job results into a single required status check.
fn check_job_results() -> Step<Run> {
    Step::new("Check job results").run(indoc::indoc! {r#"
        echo "path-check: ${{ needs.path-check.result }}"
        echo "check: ${{ needs.check.result }}"
        echo "doppler-config: ${{ needs.doppler-config.result }}"
        echo "test: ${{ needs.test.result }}"

        # Fail if any job failed (skipped and success are both OK)
        if [[ "${{ needs.path-check.result }}" == "failure" ]] || \
           [[ "${{ needs.check.result }}" == "failure" ]] || \
           [[ "${{ needs.doppler-config.result }}" == "failure" ]] || \
           [[ "${{ needs.test.result }}" == "failure" ]]; then
          echo "❌ One or more jobs failed"
          exit 1
        fi

        echo "✅ All jobs passed or were skipped"
    "#})
}
