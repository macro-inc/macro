//! `Email end-to-end (browser)` — the built web app in Chromium against the
//! `email_e2e` stack (the real email services and the provider emulators),
//! and the fixture-level browser suites of the email and calendar features.
//! Generated into `email_e2e_browser.yml`.
//!
//! It runs on every push to `main` that changes the web app or backend code,
//! and as part of `PR CI` for pull requests that touch email on either side
//! ([`PATHS`]), where it counts towards `CI gate`. A failure on `main` is a
//! red run on the merge commit; nothing is reverted or blocked by it.

use gh_workflow::{
    Concurrency, Event, Expression, Job, Push, Run, Step, Strategy, Use, Workflow, WorkflowCall,
    WorkflowDispatch,
};
use xtask_paths::RepoGlob;

use crate::workflows::{
    code_check_cloud_storage, email_e2e, runners,
    steps::{self, FluentBuilder},
    vars, web_app_check_main,
};

/// Files whose change makes `PR CI` call this workflow: what
/// [`email_e2e::PATHS`] names, and the web app's email and calendar code.
pub const PATHS: &[RepoGlob<'static>] = &[
    xtask_paths::repo_glob!("services/email_service/**"),
    xtask_paths::repo_glob!("services/email_scheduled_handler/**"),
    xtask_paths::repo_glob!("crates/email/**"),
    xtask_paths::repo_glob!("crates/email_*/**"),
    xtask_paths::repo_glob!("crates/graphql_email/**"),
    xtask_paths::repo_glob!("crates/gmail_*/**"),
    xtask_paths::repo_glob!("crates/outlook_*/**"),
    xtask_paths::repo_glob!("crates/macro_db_client/migrations/**"),
    xtask_paths::repo_glob!("apps/web/tests/email-e2e/**"),
    xtask_paths::repo_glob!("apps/web/src/features/email-*/**"),
    xtask_paths::repo_glob!("apps/web/src/features/block-email/**"),
    xtask_paths::repo_glob!("apps/web/src/features/calendar*/**"),
    xtask_paths::repo_glob!("apps/web/src/features/block-calendar/**"),
    xtask_paths::repo_glob!("apps/web/src/lib/queries/email/**"),
    xtask_paths::repo_glob!("apps/web/src/lib/queries/calendar/**"),
    xtask_paths::repo_glob!("apps/web/src/lib/core/email-link/**"),
    xtask_paths::repo_glob!("apps/web/src/features/settings/browser-test/signatures/**"),
    xtask_paths::repo_glob!(
        "apps/web/src/lib/core/component/LexicalMarkdown/component/decorator/**"
    ),
    xtask_paths::repo_glob!("packages/email-renderer/**"),
    xtask_paths::repo_glob!("apps/web/justfile"),
    xtask_paths::repo_glob!(".github/workflows/email_e2e_browser.yml"),
];

/// Files whose change on `main` runs the suite: anything the services or
/// the web bundle are built from.
const MAIN_PATHS: &[RepoGlob<'static>] = &[
    xtask_paths::repo_glob!("services/**"),
    xtask_paths::repo_glob!("crates/**"),
    xtask_paths::repo_glob!("apps/web/**"),
    xtask_paths::repo_glob!("packages/**"),
    xtask_paths::repo_glob!("Cargo.toml"),
    xtask_paths::repo_glob!("Cargo.lock"),
    xtask_paths::repo_glob!("bun.lock"),
    xtask_paths::repo_glob!("rust-toolchain.toml"),
    xtask_paths::repo_glob!("flake.nix"),
    xtask_paths::repo_glob!("flake.lock"),
    xtask_paths::repo_glob!(".github/workflows/email_e2e_browser.yml"),
];

/// Where a failed test leaves its service logs.
const SERVICE_LOGS: xtask_paths::RuntimePath<'static> =
    xtask_paths::runtime_path!("target/debug/email-e2e");

/// Where a failed test leaves its Playwright trace.
const TRACES: xtask_paths::RuntimePath<'static> =
    xtask_paths::runtime_path!("apps/web/tests/email-e2e/test-results");

/// What the coverage report of the email UI writes
/// (`apps/web/tests/email-e2e/ledger/README.md`).
const LEDGER: xtask_paths::RuntimePath<'static> =
    xtask_paths::runtime_path!("apps/web/tests/email-e2e/ledger-results/report");

/// What a run records for the coverage report: Playwright's report and what
/// each test did. Each shard uploads its own, and the coverage job lays them
/// over each other here.
const RECORDED: xtask_paths::RuntimePath<'static> =
    xtask_paths::runtime_path!("apps/web/tests/email-e2e/ledger-results");

/// The machines the suite is split over. One ran it in ten minutes at 373
/// tests, behind five of building; raise this when a shard passes fifteen.
const SHARDS: u32 = 3;

/// The job that runs a shard of the suite.
const SUITE_JOB: &str = "email-e2e-browser";

/// Build the workflow.
pub fn email_e2e_browser() -> Workflow {
    let push = MAIN_PATHS
        .iter()
        .fold(Push::default().add_branch("main"), |push, path| {
            push.add_path(path.as_str())
        });

    Workflow::new("Email end-to-end (browser)")
        .on(Event::default()
            .push(push)
            .workflow_dispatch(WorkflowDispatch::default())
            .workflow_call(WorkflowCall::default()))
        .concurrency(concurrency())
        .map(vars::with_global_env)
        .add_job(SUITE_JOB, suite())
        .add_job("email-e2e-browser-coverage", coverage())
}

/// As the Rust suite: every commit on `main` keeps its own result.
fn concurrency() -> Concurrency {
    Concurrency::new(Expression::new(
        "email-e2e-browser-${{ github.event_name == 'pull_request' && github.run_id || github.sha }}",
    ))
    .cancel_in_progress(true)
}

/// Build the services and the web bundle, then run a shard of the browser
/// tests against Postgres, Redis, an SQS-compatible server and a Kafka
/// broker. A failed shard does not stop the others: the coverage job reads
/// what all of them recorded.
fn suite() -> Job {
    let shards: Vec<u32> = (1..=SHARDS).collect();
    Job::default()
        .name(format!(
            "Email end-to-end (browser) (${{{{ matrix.shard }}}}/{SHARDS})"
        ))
        .timeout_minutes(30u32)
        .strategy(
            Strategy::default()
                .fail_fast(false)
                .matrix(serde_json::json!({ "shard": shards })),
        )
        .add_env((
            "EMAIL_E2E_SHARD",
            format!("${{{{ matrix.shard }}}}/{SHARDS}"),
        ))
        .runs_on(runners::Runner::Large.with_cache_tag(vars::CI_CACHE_TAG))
        .map(code_check_cloud_storage::with_test_compile_env)
        .add_env(("SQLX_OFFLINE", "true"))
        .add_env(("SCCACHE_IDLE_TIMEOUT", "0"))
        .add_env((
            "EMAIL_E2E_DATABASE_URL",
            "postgres://user:password@127.0.0.1:5432/macrodb",
        ))
        .add_env(("EMAIL_E2E_REDIS_URL", "redis://127.0.0.1:6379"))
        .add_env(("EMAIL_E2E_SQS_URL", "http://127.0.0.1:9324"))
        .add_env(("EMAIL_E2E_KAFKA_BROKERS", "127.0.0.1:9092"))
        .add_env(("EMAIL_E2E_BROWSER_WORKERS", "8"))
        .add_service("postgres", code_check_cloud_storage::postgres_service())
        .add_service("redis", code_check_cloud_storage::redis_service())
        .add_service("sqs", email_e2e::sqs_service())
        .add_service("kafka", email_e2e::kafka_service())
        .add_step(steps::checkout(false, false))
        .add_step(steps::mount_cache_volume())
        .add_step(steps::setup_nix_with_seed())
        .add_step(steps::setup_reqs_web("Setup", true))
        .add_step(steps::configure_namespace_sccache(vars::CI_SCCACHE_NAME))
        .add_step(steps::start_sccache_server())
        .add_step(steps::code_mode_assets())
        .add_step(email_e2e::raise_connection_limit())
        .add_step(code_check_cloud_storage::configure_postgres())
        .add_step(run_suite())
        .add_step(known_bugs())
        .add_step(
            steps::upload_artifact("email-e2e-browser-recorded-${{ matrix.shard }}", RECORDED)
                .add_with(("if-no-files-found", "ignore"))
                .add_with(("retention-days", 7))
                .if_condition(Expression::new("!cancelled()")),
        )
        .add_step(upload(
            "email-e2e-browser-logs-${{ matrix.shard }}",
            SERVICE_LOGS,
        ))
        .add_step(upload(
            "email-e2e-browser-traces-${{ matrix.shard }}",
            TRACES,
        ))
        .add_step(steps::show_sccache_stats())
        .add_step(steps::teardown_nix())
}

/// What the shards recorded, as one run: the coverage check of the email UI
/// (`ledger()`). It runs when a shard failed too, and then says what the
/// tests that passed cover; a shard that recorded nothing leaves its rows
/// uncovered, which fails the check.
fn coverage() -> Job {
    Job::default()
        .name("Email end-to-end (browser) coverage")
        .needs(vec![SUITE_JOB.to_string()])
        .cond(Expression::new("!cancelled()"))
        .timeout_minutes(15u32)
        .runs_on(runners::Runner::Small.with_cache_tag(vars::CI_CACHE_TAG))
        .add_step(steps::checkout(false, false))
        .add_step(steps::mount_cache_volume())
        .add_step(steps::setup_nix_with_seed())
        .add_step(steps::setup_reqs_web("Setup", false))
        .add_step(download_recorded())
        .add_step(ledger())
        .add_step(
            steps::upload_artifact("email-e2e-browser-coverage", LEDGER)
                .add_with(("if-no-files-found", "ignore"))
                .add_with(("retention-days", 30))
                .if_condition(Expression::new("!cancelled()")),
        )
        .add_step(steps::teardown_nix())
}

/// Every shard's recorded results, laid over each other: the reports have a
/// name per shard and the evidence files a name per test result.
fn download_recorded() -> Step<Use> {
    Step::new("Download what the shards recorded")
        .uses(
            "actions",
            "download-artifact",
            "634f93cb2916e3fdff6788551b99b062d0335ce0",
        ) // v5
        .add_with(("pattern", "email-e2e-browser-recorded-*"))
        .add_with(("path", RECORDED.as_str()))
        .add_with(("merge-multiple", true))
}

/// The built app against the stack and, beside it, the fixture tests of the
/// email and calendar features: real components over scripted data, for
/// what needs no backend.
fn run_suite() -> Step<Run> {
    web_app_check_main::with_pr_wasm_env(
        Step::new("run the email browser suite").run(include_str!("scripts/email_e2e_browser.sh")),
    )
}

/// Tests kept for known, unfixed bugs fail by design, so this step never
/// fails the job: its output says which still fail and which now pass. A
/// test that is expected to fail is not retried. One that passes fails the
/// ledger step below, until its tag is removed. Its traces go beside the
/// suite's, which a second run into the same directory would delete.
fn known_bugs() -> Step<Run> {
    Step::new("report tests for known bugs")
        .run(
            "just test-email-e2e-browser --pass-with-no-tests --retries 0 \
             --shard \"$EMAIL_E2E_SHARD\" --output tests/email-e2e/test-results/known-bugs",
        )
        .add_env(("EMAIL_E2E_KNOWN_BUGS", "1"))
        .working_directory(xtask_paths::repo_dir!("apps/web"))
        .continue_on_error(true)
        .if_condition(Expression::new("!cancelled()"))
}

/// What the suite covers of the email UI, from what the two runs of every
/// shard recorded: the job summary and the `email-e2e-browser-coverage` artifact.
/// It fails the job when a function or a row of the manifest has neither a
/// passing test on this stack nor a waiver, when a waived one is covered, and
/// when a test for a known bug passes (`ledger/README.md`). It runs after a
/// failed suite too, where it says what the tests that passed cover.
fn ledger() -> Step<Run> {
    Step::new("check the coverage of the email UI")
        .run("just email-e2e-ledger --enforce")
        .working_directory(xtask_paths::repo_dir!("apps/web"))
        .if_condition(Expression::new("!cancelled()"))
}

fn upload(name: &str, path: xtask_paths::RuntimePath<'static>) -> Step<Use> {
    steps::upload_artifact(name, path)
        .add_with(("if-no-files-found", "ignore"))
        .add_with(("retention-days", 7))
        .if_condition(Expression::new("failure()"))
}
