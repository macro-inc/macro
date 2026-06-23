//! `cloud storage code check` — cargo fmt/clippy/test for the cloud-storage
//! workspace on pull requests. Generated into `code-check-cloud-storage.yml`.
//!
//! Ported from the hand-written workflow, with two infra changes: the runners
//! moved to Namespace profiles, and sccache moved off the S3 bucket onto a
//! persisted Namespace cache volume (so there are no AWS credentials anywhere).

use gh_workflow::{
    Container, Env, Event, Expression, Job, Port, PullRequest, PullRequestType, Run, Step, Workflow,
};

use crate::workflows::{
    runners,
    steps::{self, FluentBuilder},
    vars,
};

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
        .runs_on(runners::LINUX_SMALL)
        .add_output("should_run", "${{ steps.filter.outputs.should_run }}")
        .add_output(
            "nextest_filter",
            "${{ steps.nextest-filter.outputs.nextest_filter }}",
        )
        .add_output(
            "doppler_config_bins",
            "${{ steps.doppler-bins.outputs.doppler_config_bins }}",
        )
        .add_step(steps::checkout(true))
        .add_step(steps::setup_rust_light())
        .add_step(paths_filter())
        .add_step(compute_changed_files())
        .add_step(compute_doppler_bins())
        .add_step(compute_nextest_filter())
}

/// fmt + clippy (and Doppler-config validation).
fn check() -> Job {
    steps::gated_job()
        .runs_on(runners::LINUX_MID)
        .add_env((
            "RUSTFLAGS",
            "-Dwarnings -Dclippy::disallowed_methods -C link-arg=-fuse-ld=mold",
        ))
        .add_env(("RUSTDOCFLAGS", "-Dwarnings"))
        .add_step(steps::checkout(false))
        .add_step(steps::mount_cache_volume())
        .add_step(steps::setup_dev_shell())
        .add_step(steps::pin_sccache_dir())
        .add_step(validate_doppler_configs())
        .add_step(cargo_fmt())
        .add_step(cargo_clippy())
        .add_step(steps::show_sccache_stats())
}

/// cargo nextest against postgres + redis service containers.
fn test() -> Job {
    steps::gated_job()
        .runs_on(runners::LINUX_MID)
        .add_env((
            "NEXTEST_FILTER",
            "${{ needs.path-check.outputs.nextest_filter }}",
        ))
        .add_env(("NEXTEST_TEST_THREADS", vars::NEXTEST_TEST_THREADS))
        .add_env(("RUSTFLAGS", "-Dwarnings -C link-arg=-fuse-ld=mold"))
        .add_service("postgres", postgres_service())
        .add_service("redis", redis_service())
        .add_step(steps::checkout(false))
        .add_step(steps::mount_cache_volume())
        .add_step(steps::setup_dev_shell())
        .add_step(steps::pin_sccache_dir())
        .add_step(configure_postgres())
        .add_step(prepare_tests())
        .add_step(run_tests())
        .add_step(steps::show_sccache_stats())
}

/// Always-run collector used as the required status check. Its name must stay
/// stable — branch protection references it.
fn status_check() -> Job {
    Job::default()
        .name("Cloud Storage Status Check")
        .runs_on(runners::LINUX_SMALL)
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
        .uses("dorny", "paths-filter", "v3")
        .id("filter")
        .add_with((
            "filters",
            indoc::indoc! {r#"
                should_run:
                  - 'rust/cloud-storage/**'
                  - 'rust/rust-toolchain.toml'
                  - 'flake.nix'
                  - 'flake.lock'
                  - '.github/actions/setup-cachix/**'
                  - '.github/actions/setup-sccache/**'
                  - '.github/services-config.json'
                  - '.github/scripts/build-cloud-storage-lambdas.sh'
                  - '.github/scripts/build-cloud-storage-lambdas-nix.sh'
                  - .github/workflows/code-check-cloud-storage.yml
            "#},
        ))
}

/// Compute the changed-file set once (shared by the nextest filter and the
/// Doppler-bin detection) and write it to `/tmp/changed-files`. On a missing
/// merge-base we leave the list empty, which makes both downstream steps fall
/// back to "everything": run all tests, validate no Doppler bins.
fn compute_changed_files() -> Step<Run> {
    Step::new("compute changed files")
        .run(indoc::indoc! {r#"
            set -euo pipefail

            if [ -z "${GITHUB_BASE_REF:-}" ]; then
              compare_rev="$(git rev-parse HEAD~1)"
            else
              git fetch origin "$GITHUB_BASE_REF:refs/remotes/origin/$GITHUB_BASE_REF"
              if ! compare_rev="$(git merge-base "origin/${GITHUB_BASE_REF}" HEAD)"; then
                echo "Unable to find merge-base for origin/${GITHUB_BASE_REF}; falling back to full test suite" >&2
                : > /tmp/changed-files
                exit 0
              fi
            fi

            git diff --name-only "$compare_rev" "$GITHUB_SHA" > /tmp/changed-files
        "#})
        .if_condition(Expression::new("steps.filter.outputs.should_run == 'true'"))
        .shell("bash")
}

/// Determine which services' Doppler config-validation binaries are affected by
/// the changed files, via the `xtask doppler-bins` subcommand.
fn compute_doppler_bins() -> Step<Run> {
    Step::new("compute affected Doppler config bins")
        .run(indoc::indoc! {r#"
            set -euo pipefail

            doppler_config_bins="$(cargo run --manifest-path rust/cloud-storage/tools/xtask/Cargo.toml -- doppler-bins /tmp/changed-files)"
            {
              echo 'doppler_config_bins<<__DOPPLER_CONFIG_BINS__'
              if [ -n "$doppler_config_bins" ]; then
                printf '%s\n' "$doppler_config_bins"
              fi
              echo '__DOPPLER_CONFIG_BINS__'
            } >> "$GITHUB_OUTPUT"
        "#})
        .id("doppler-bins")
        .if_condition(Expression::new("steps.filter.outputs.should_run == 'true'"))
        .shell("bash")
}

/// Compute the cargo-nextest package filter from the changed files, via the
/// `xtask nextest-filter` subcommand. Root cargo/toolchain/CI changes
/// short-circuit to an empty filter (run the whole suite).
fn compute_nextest_filter() -> Step<Run> {
    Step::new("compute nextest package filter")
        .run(indoc::indoc! {r#"
            set -euo pipefail

            # Root cargo/toolchain/CI changes can affect the whole workspace, so run all tests.
            if grep -qE '^(rust/rust-toolchain\.toml|flake\.nix|flake\.lock|rust/cloud-storage/Cargo\.(toml|lock)|rust/cloud-storage/\.cargo/.*|\.github/actions/(setup-rust|setup-cachix|setup-sccache)/.*|\.github/workflows/code-check-cloud-storage\.yml)$' /tmp/changed-files; then
              echo "Workspace-level change detected; running all tests"
              echo "nextest_filter=" >> "$GITHUB_OUTPUT"
              exit 0
            fi

            filterset="$(cargo run --manifest-path rust/cloud-storage/tools/xtask/Cargo.toml -- nextest-filter /tmp/changed-files)"

            if [ -z "$filterset" ]; then
              echo "No package-specific Rust changes detected; running all tests"
            else
              echo "nextest filter: $filterset"
            fi
            echo "nextest_filter=$filterset" >> "$GITHUB_OUTPUT"
        "#})
        .id("nextest-filter")
        .if_condition(Expression::new("steps.filter.outputs.should_run == 'true'"))
        .shell("bash")
}

/// Build and run the Doppler config binaries affected by this PR. (sccache is
/// local now, so this no longer needs AWS credentials — only the assertion that
/// `RUSTC_WRAPPER` is wired stays.)
fn validate_doppler_configs() -> Step<Run> {
    Step::new("validate Doppler configs")
        .run(indoc::indoc! {r#"
            set -euo pipefail

            if [ -z "${DOPPLER_TOKEN:-}" ]; then
              echo "DOPPLER_TOKEN secret is required to validate Doppler configs" >&2
              exit 1
            fi

            if [ -z "${RUSTC_WRAPPER:-}" ]; then
              echo "RUSTC_WRAPPER is required so Doppler config binaries build through sccache" >&2
              exit 1
            fi

            bins=()
            cargo_args=(build --locked --all-features)
            while IFS= read -r bin; do
              if [ -z "$bin" ]; then
                continue
              fi

              bins+=("$bin")
              cargo_args+=(--bin "$bin")
            done <<< "$DOPPLER_CONFIG_BINS"

            if [ "${#bins[@]}" -eq 0 ]; then
              echo "No Doppler config binaries to validate"
              exit 0
            fi

            echo "Building affected Doppler config binaries with RUSTC_WRAPPER=$RUSTC_WRAPPER"
            printf '  %s\n' "${bins[@]}"

            (
              cd rust/cloud-storage
              cargo "${cargo_args[@]}"
              for bin in "${bins[@]}"; do
                "./target/debug/$bin"
              done
            )
        "#})
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
    Step::new("fmt").run("cd rust/cloud-storage && cargo fmt --check")
}

/// `cargo clippy` (no AWS creds — sccache is local).
fn cargo_clippy() -> Step<Run> {
    Step::new("clippy").run("cd rust/cloud-storage && cargo clippy --workspace --all-features")
}

/// pgvector service container, tuned env preserved.
fn postgres_service() -> Container {
    Container::default()
        .image("pgvector/pgvector:pg16")
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
    Step::new("configure postgres for concurrent tests").run(indoc::indoc! {r#"
        postgres_container="$(docker ps --format '{{.ID}} {{.Image}}' | awk '$2 == "pgvector/pgvector:pg16" { print $1; exit }')"
        if [ -z "$postgres_container" ]; then
          echo "pgvector/pgvector:pg16 service container not found" >&2
          docker ps
          exit 1
        fi

        docker exec -i "$postgres_container" psql -U user -d macrodb <<'SQL'
        ALTER SYSTEM SET fsync = off;
        ALTER SYSTEM SET synchronous_commit = off;
        ALTER SYSTEM SET full_page_writes = off;
        ALTER SYSTEM SET max_wal_size = '4GB';
        ALTER SYSTEM SET checkpoint_timeout = '30min';
        ALTER SYSTEM SET max_locks_per_transaction = 8192;
        SQL
        docker restart "$postgres_container"
        until docker exec "$postgres_container" pg_isready -U user -d macrodb; do
          sleep 1
        done
        docker exec "$postgres_container" psql -U user -d macrodb -c "SHOW max_locks_per_transaction;"
    "#})
}

/// Set up test env files and databases.
fn prepare_tests() -> Step<Run> {
    Step::new("prepare tests")
        .run("just rust/cloud-storage/setup_test_envs && just rust/cloud-storage/initialize_dbs")
}

/// Run the test suite (no AWS creds — sccache is local).
fn run_tests() -> Step<Run> {
    Step::new("run tests").run(indoc::indoc! {r#"
        cd rust/cloud-storage

        args=(--all-features --lib --bins --tests --test-threads "$NEXTEST_TEST_THREADS")
        if [ -n "$NEXTEST_FILTER" ]; then
          args+=(-E "$NEXTEST_FILTER")
        fi
        cargo nextest run "${args[@]}"
    "#})
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
