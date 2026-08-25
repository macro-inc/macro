//! `cloud storage code check` — cargo fmt/clippy/test for the cloud-storage
//! workspace on pull requests. Generated into `code-check-cloud-storage.yml`.
//!
//! Ported from the hand-written workflow, with two infra changes: the runners
//! moved to Namespace profiles, and compiled objects moved off the S3/local
//! volume backends onto Namespace's official remote sccache (so there are no
//! AWS credentials anywhere).

use gh_workflow::{
    Container, Env, Event, Expression, Job, Port, PullRequest, PullRequestType, Run, Step, Workflow,
};

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
        .add_job("test", test())
        .add_job("status-check", status_check())
}

/// Decide whether the rest of the workflow runs, and compute the nextest filter.
fn path_check() -> Job {
    Job::default()
        .runs_on(runners::Runner::Small.to_string())
        .add_output("should_run", "${{ steps.filter.outputs.should_run }}")
        .add_output(
            "rust_packages",
            "${{ steps.nextest-filter.outputs.rust_packages }}",
        )
        .add_output(
            "skip_tests",
            "${{ steps.nextest-filter.outputs.skip_tests }}",
        )
        .add_output(
            "doppler_config_bins",
            "${{ steps.doppler-bins.outputs.doppler_config_bins }}",
        )
        // PR merge commits need both parents for `git merge-base`; fetching
        // the entire repo (every branch) is not required.
        .add_step(steps::checkout(false, false).add_with(("fetch-depth", 2)))
        .add_step(steps::setup_rust_light())
        .add_step(paths_filter())
        .add_step(compute_changed_files())
        .add_step(compute_doppler_bins())
        .add_step(compute_nextest_filter())
}

/// fmt + clippy (and Doppler-config validation).
fn check() -> Job {
    steps::gated_job()
        .runs_on(runners::Runner::RustCi.with_cache_tag(vars::CI_CACHE_TAG))
        .add_env((
            "RUSTFLAGS",
            "-Dwarnings -Dclippy::disallowed_methods -C link-arg=-fuse-ld=mold",
        ))
        .add_env(("RUSTDOCFLAGS", "-Dwarnings"))
        .add_env(("SQLX_OFFLINE", "true"))
        .add_step(steps::checkout(false, false))
        .add_step(steps::mount_cache_volume())
        .add_step(steps::setup_nix())
        .add_step(steps::setup_dev_shell())
        .add_step(steps::configure_namespace_sccache(vars::CI_SCCACHE_NAME))
        .add_step(validate_doppler_configs())
        .add_step(cargo_fmt())
        .add_step(cargo_clippy())
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
        .add_service("postgres", postgres_service())
        .add_service("redis", redis_service())
        .add_step(steps::checkout(false, false))
        .add_step(steps::mount_cache_volume())
        .add_step(steps::setup_nix())
        .add_step(steps::setup_dev_shell())
        .add_step(steps::configure_namespace_sccache(vars::CI_SCCACHE_NAME))
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
            "test".to_string(),
        ])
        .add_step(check_job_results())
}

// --- workflow-specific steps -------------------------------------------------

/// Detect whether cloud-storage-relevant paths changed.
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
                  - .github/workflows/code_check_cloud_storage.yml
            "#},
        ))
}

/// Compute the changed-file set once (shared by the nextest filter and the
/// Doppler-bin detection) and write it to `/tmp/changed-files`. On a missing
/// merge-base we leave the list empty, which makes both downstream steps fall
/// back to "everything": run all tests, validate no Doppler bins.
fn compute_changed_files() -> Step<Run> {
    Step::new("compute changed files")
        .run(include_str!("scripts/compute_changed_files.sh"))
        .if_condition(Expression::new("steps.filter.outputs.should_run == 'true'"))
        .shell("bash")
}

/// Determine which services' Doppler config-validation binaries are affected by
/// the changed files, via the `xtask doppler-bins` subcommand.
fn compute_doppler_bins() -> Step<Run> {
    Step::new("compute affected Doppler config bins")
        .run(include_str!("scripts/compute_doppler_bins.sh"))
        .id("doppler-bins")
        .if_condition(Expression::new("steps.filter.outputs.should_run == 'true'"))
        .shell("bash")
}

/// Compute the cargo-nextest / clippy package set from the changed files, via
/// the `xtask nextest-filter` subcommand. Root Cargo/toolchain changes
/// short-circuit to the full suite; unmapped files (a top-level JSON, a Nix
/// shell tweak) select no packages.
fn compute_nextest_filter() -> Step<Run> {
    Step::new("compute nextest package filter")
        .run(include_str!("scripts/compute_nextest_filter.sh"))
        .id("nextest-filter")
        .if_condition(Expression::new("steps.filter.outputs.should_run == 'true'"))
        .shell("bash")
}

/// Build and run the Doppler config binaries affected by this PR. Namespace's
/// remote sccache needs no AWS credentials; only the assertion that
/// `RUSTC_WRAPPER` is wired stays.
fn validate_doppler_configs() -> Step<Run> {
    Step::new("validate Doppler configs")
        .run(include_str!("scripts/validate_doppler_configs.sh"))
        .if_condition(Expression::new(
            "needs.path-check.outputs.doppler_config_bins != ''",
        ))
        .add_env((
            "DOPPLER_CONFIG_BINS",
            "${{ needs.path-check.outputs.doppler_config_bins }}",
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

/// Set up test env files and databases.
fn prepare_tests() -> Step<Run> {
    Step::new("prepare tests").run("just setup_test_envs && just initialize_dbs")
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
        echo "test: ${{ needs.test.result }}"

        # Fail if any job failed (skipped and success are both OK)
        if [[ "${{ needs.path-check.result }}" == "failure" ]] || \
           [[ "${{ needs.check.result }}" == "failure" ]] || \
           [[ "${{ needs.test.result }}" == "failure" ]]; then
          echo "❌ One or more jobs failed"
          exit 1
        fi

        echo "✅ All jobs passed or were skipped"
    "#})
}
