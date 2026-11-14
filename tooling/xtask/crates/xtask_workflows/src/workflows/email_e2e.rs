//! `Email end-to-end` — the `email_e2e` suite: the real `email_service`,
//! its workers and `calendar_service` against the Gmail and Outlook emulators. Generated into
//! `email_e2e.yml`.
//!
//! The scenarios are divided over jobs that run side by side, so the
//! workflow takes as long as its slowest job, not as long as their sum: the
//! scenarios without search in [`PARTITIONS`] parts, the search scenarios
//! with their OpenSearch, and the scenarios kept for known bugs. A last job
//! reads what the gating scenarios recorded and reports which functions of
//! email and which backend entry points they cover (`cargo x email-coverage`).
//!
//! It runs on every push to `main` that changes backend code, because a
//! shared crate or a migration can break email as easily as email code can,
//! and as part of `PR CI` for pull requests that touch email itself
//! ([`PATHS`]), where it counts towards `CI gate`. A failure on `main` is a
//! red run on the merge commit; nothing is reverted or blocked by it.

use gh_workflow::{
    Concurrency, Container, Env, Event, Expression, Job, Port, Push, Run, Step, Strategy, Use,
    Workflow, WorkflowCall, WorkflowDispatch,
};
use xtask_paths::RepoGlob;

use crate::workflows::{
    code_check_cloud_storage, runners,
    steps::{self, FluentBuilder},
    vars,
};

/// Files whose change makes `PR CI` call this workflow: email and calendar code,
/// the provider emulators, the schema, and the suite.
pub const PATHS: &[RepoGlob<'static>] = &[
    xtask_paths::repo_glob!("services/email_service/**"),
    xtask_paths::repo_glob!("services/email_scheduled_handler/**"),
    xtask_paths::repo_glob!("services/user_link_cleanup_handler/**"),
    xtask_paths::repo_glob!("services/email_sfs_delete_handler/**"),
    xtask_paths::repo_glob!("services/email_suppression_handler/**"),
    xtask_paths::repo_glob!("crates/email/**"),
    xtask_paths::repo_glob!("crates/email_*/**"),
    xtask_paths::repo_glob!("crates/graphql_email/**"),
    xtask_paths::repo_glob!("services/calendar_service/**"),
    xtask_paths::repo_glob!("crates/calendar_*/**"),
    xtask_paths::repo_glob!("crates/gmail_*/**"),
    xtask_paths::repo_glob!("crates/outlook_*/**"),
    xtask_paths::repo_glob!("services/search_processing_service/**"),
    xtask_paths::repo_glob!("crates/opensearch_client/**"),
    xtask_paths::repo_glob!("infra/stacks/opensearch/helpers/**"),
    xtask_paths::repo_glob!("infra/local/opensearch/**"),
    xtask_paths::repo_glob!("tooling/xtask/crates/xtask_email_coverage/**"),
    xtask_paths::repo_glob!("apps/web/tests/email-e2e/ledger/**"),
    xtask_paths::repo_glob!("crates/macro_db_client/migrations/**"),
    xtask_paths::repo_glob!(".config/nextest.toml"),
    xtask_paths::repo_glob!(".github/workflows/email_e2e.yml"),
];

/// Files whose change on `main` runs the suite: anything the two services
/// are built from.
const MAIN_PATHS: &[RepoGlob<'static>] = &[
    xtask_paths::repo_glob!("services/**"),
    xtask_paths::repo_glob!("crates/**"),
    xtask_paths::repo_glob!("Cargo.toml"),
    xtask_paths::repo_glob!("Cargo.lock"),
    xtask_paths::repo_glob!("rust-toolchain.toml"),
    xtask_paths::repo_glob!("flake.nix"),
    xtask_paths::repo_glob!("flake.lock"),
    xtask_paths::repo_glob!(".config/nextest.toml"),
    xtask_paths::repo_glob!(".github/workflows/email_e2e.yml"),
];

/// How many jobs the scenarios without search are divided over.
const PARTITIONS: u8 = 3;

/// The search scenarios: one test binary, and the only one that needs
/// OpenSearch and the indexer.
const SEARCH: &str = "binary(search)";

/// Every other scenario.
const WITHOUT_SEARCH: &str = "not binary(search)";

/// Where the suite keeps each scenario's service logs.
const LOGS: xtask_paths::RuntimePath<'static> =
    xtask_paths::runtime_path!("target/debug/email-e2e");

/// Where a job gathers what the coverage report reads: the run's results and
/// each scenario's record.
const RESULTS: xtask_paths::RuntimePath<'static> =
    xtask_paths::runtime_path!("target/email-e2e-results");

/// Where the coverage job writes its report.
const COVERAGE: xtask_paths::RuntimePath<'static> =
    xtask_paths::runtime_path!("target/email-e2e-coverage");

/// The jobs whose scenarios gate, by id.
const GATING_JOBS: [&str; 2] = ["email-e2e", "email-e2e-search"];

/// Build the workflow.
pub fn email_e2e() -> Workflow {
    let push = MAIN_PATHS
        .iter()
        .fold(Push::default().add_branch("main"), |push, path| {
            push.add_path(path.as_str())
        });

    Workflow::new("Email end-to-end")
        .on(Event::default()
            .push(push)
            .workflow_dispatch(WorkflowDispatch::default())
            .workflow_call(WorkflowCall::default()))
        .concurrency(concurrency())
        .map(vars::with_global_env)
        .add_job("email-e2e", scenarios())
        .add_job("email-e2e-search", search())
        .add_job("email-e2e-known-bugs", known_bug_scenarios())
        .add_job("email-e2e-coverage", coverage())
}

/// Every commit on `main` gets its own result: a later merge does not cancel
/// the run of an earlier one, so a break can be traced to its commit. Within
/// `PR CI` the group is that run's own, because `PR CI` cancels its own
/// superseded runs.
fn concurrency() -> Concurrency {
    Concurrency::new(Expression::new(
        "email-e2e-${{ github.event_name == 'pull_request' && github.run_id || github.sha }}",
    ))
    .cancel_in_progress(true)
}

/// Start a job of the suite: the runner, the servers every scenario needs,
/// and the toolchain.
fn job(name: &str) -> Job {
    Job::default()
        .name(name)
        .timeout_minutes(45u32)
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
        .add_env(("EMAIL_E2E_RESULTS", RESULTS.as_str()))
        .add_service("postgres", code_check_cloud_storage::postgres_service())
        .add_service("redis", code_check_cloud_storage::redis_service())
        .add_service("sqs", sqs_service())
        .add_service("kafka", kafka_service())
        .add_step(steps::checkout(false, false))
}

/// The steps between the checkout and the scenarios: the toolchain, the
/// database, and the services' binaries.
fn prepare(job: Job) -> Job {
    job.add_step(steps::mount_cache_volume())
        .add_step(steps::setup_nix_with_seed())
        .add_step(steps::setup_dev_shell().timeout_minutes(vars::DEV_SHELL_TIMEOUT_MINUTES))
        .add_step(steps::configure_namespace_sccache(vars::CI_SCCACHE_NAME))
        .add_step(steps::start_sccache_server())
        .add_step(steps::code_mode_assets())
        .add_step(raise_connection_limit())
        .add_step(code_check_cloud_storage::configure_postgres())
        .add_step(build_services())
}

/// The steps after the scenarios.
fn finish(job: Job, logs: &str) -> Job {
    job.add_step(upload_logs(logs))
        .add_step(steps::show_sccache_stats())
        .add_step(steps::teardown_nix())
}

/// The scenarios that need no search cluster, divided over [`PARTITIONS`]
/// jobs that run side by side.
fn scenarios() -> Job {
    let parts: Vec<u8> = (1..=PARTITIONS).collect();
    job(&format!(
        "Email end-to-end (${{{{ matrix.partition }}}}/{PARTITIONS})"
    ))
    // A failure in one part says nothing about the others: let them finish.
    .strategy(Strategy {
        matrix: Some(serde_json::json!({ "partition": parts })),
        fail_fast: Some(false),
        max_parallel: None,
    })
    .add_env(("EMAIL_E2E_SCENARIOS", WITHOUT_SEARCH))
    .add_env((
        "EMAIL_E2E_PARTITION",
        format!("slice:${{{{ matrix.partition }}}}/{PARTITIONS}"),
    ))
    .map(prepare)
    .add_step(run_scenarios())
    .map(|job| keep_results(job, "email-e2e-results-${{ matrix.partition }}"))
    .map(|job| finish(job, "email-e2e-logs-${{ matrix.partition }}"))
}

/// The search scenarios, with OpenSearch and the indexer, and the search
/// scenarios kept for known bugs.
fn search() -> Job {
    job("Email end-to-end (search)")
        .add_env(("EMAIL_E2E_OPENSEARCH_URL", "http://127.0.0.1:9200"))
        .add_env(("EMAIL_E2E_SCENARIOS", SEARCH))
        .add_env(("EMAIL_E2E_BUILD_INDEXER", "true"))
        .add_step(start_opensearch())
        .map(prepare)
        .add_step(create_search_indices())
        .add_step(run_scenarios())
        .map(|job| keep_results(job, "email-e2e-results-search"))
        .add_step(known_bugs())
        .map(|job| finish(job, "email-e2e-logs-search"))
}

/// The scenarios kept for known, unfixed bugs, outside search. They fail by
/// design and several wait out a timeout, so they have a job of their own
/// that never fails for a scenario: it reports which still fail and which
/// now pass.
fn known_bug_scenarios() -> Job {
    job("Email end-to-end (known bugs)")
        .add_env(("EMAIL_E2E_SCENARIOS", WITHOUT_SEARCH))
        .map(prepare)
        .add_step(known_bugs())
        .add_step(steps::show_sccache_stats())
        .add_step(steps::teardown_nix())
}

/// Reports what the gating scenarios cover, from the records the jobs kept.
/// It runs when scenarios failed too: the report says which, and counts only
/// the ones that passed. Gaps do not fail it; a list that no longer matches
/// the code does.
fn coverage() -> Job {
    Job::default()
        .name("Email end-to-end (coverage)")
        .timeout_minutes(15u32)
        .runs_on(runners::Runner::Small.to_string())
        .needs(GATING_JOBS.map(str::to_owned).to_vec())
        .cond(Expression::new("always()"))
        .add_env(("EMAIL_E2E_RESULTS", RESULTS.as_str()))
        .add_env(("EMAIL_E2E_COVERAGE", COVERAGE.as_str()))
        .add_step(steps::checkout(false, false))
        .add_step(steps::setup_rust_light())
        .add_step(
            Step::new("download the scenarios' records")
                .uses(
                    "actions",
                    "download-artifact",
                    "634f93cb2916e3fdff6788551b99b062d0335ce0",
                ) // v5
                .add_with(("pattern", "email-e2e-results-*"))
                .add_with(("path", RESULTS.as_str())),
        )
        .add_step(
            Step::new("report the coverage").run(include_str!("scripts/email_e2e_coverage.sh")),
        )
        .add_step(
            steps::upload_artifact("email-e2e-coverage", COVERAGE)
                .add_with(("if-no-files-found", "ignore"))
                .if_condition(Expression::new("always()")),
        )
}

/// Keeps the run's results and the scenarios' records for the coverage job,
/// whether or not the scenarios passed.
fn keep_results(job: Job, name: &str) -> Job {
    job.add_step(
        Step::new("keep the results for the coverage report")
            .run(include_str!("scripts/email_e2e_results.sh"))
            .if_condition(Expression::new("always()")),
    )
    .add_step(
        steps::upload_artifact(name, RESULTS)
            .add_with(("if-no-files-found", "ignore"))
            .add_with(("retention-days", 7))
            .if_condition(Expression::new("always()")),
    )
}

/// ElasticMQ: the SQS-compatible server the scenarios' queues live on.
fn sqs_service() -> Container {
    Container::default()
        .image("softwaremill/elasticmq-native:1.7.1")
        .ports(vec![Port::Name("9324:9324".to_string())])
}

/// A single-node Kafka, the version the local stack runs. The services only
/// publish to it.
fn kafka_service() -> Container {
    Container::default()
        .image("apache/kafka:3.9.1")
        .env(
            Env::new("KAFKA_NODE_ID", "1")
                .add("KAFKA_PROCESS_ROLES", "broker,controller")
                .add("KAFKA_CONTROLLER_QUORUM_VOTERS", "1@localhost:9093")
                .add("KAFKA_CONTROLLER_LISTENER_NAMES", "CONTROLLER")
                .add(
                    "KAFKA_LISTENERS",
                    "PLAINTEXT://0.0.0.0:9092,CONTROLLER://0.0.0.0:9093",
                )
                .add("KAFKA_ADVERTISED_LISTENERS", "PLAINTEXT://127.0.0.1:9092")
                .add(
                    "KAFKA_LISTENER_SECURITY_PROTOCOL_MAP",
                    "PLAINTEXT:PLAINTEXT,CONTROLLER:PLAINTEXT",
                )
                .add("KAFKA_INTER_BROKER_LISTENER_NAME", "PLAINTEXT")
                .add("KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR", "1")
                .add("KAFKA_TRANSACTION_STATE_LOG_REPLICATION_FACTOR", "1")
                .add("KAFKA_TRANSACTION_STATE_LOG_MIN_ISR", "1")
                .add("KAFKA_AUTO_CREATE_TOPICS_ENABLE", "true"),
        )
        .ports(vec![Port::Name("9092:9092".to_string())])
        .options(
            "--health-cmd \"/opt/kafka/bin/kafka-broker-api-versions.sh --bootstrap-server \
             localhost:9092 > /dev/null 2>&1\" --health-interval 2s --health-start-period 60s \
             --health-timeout 10s --health-retries 20",
        )
}

/// OpenSearch for the search scenarios. Not a service container: the image
/// is built from the local stack's Dockerfile, which adds a plugin. Started
/// first, so it is up by the time the services are built.
fn start_opensearch() -> Step<Run> {
    Step::new("start opensearch").run(include_str!("scripts/email_e2e_opensearch.sh"))
}

fn create_search_indices() -> Step<Run> {
    Step::new("create the search indices").run(include_str!("scripts/email_e2e_search_indices.sh"))
}

/// Room for every scenario's connection pools.
fn raise_connection_limit() -> Step<Run> {
    Step::new("raise the postgres connection limit")
        .run(include_str!("scripts/email_e2e_postgres.sh"))
}

/// Build what the scenarios start. Every job builds for itself; the compiler
/// cache is shared.
fn build_services() -> Step<Run> {
    Step::new("build the services").run(include_str!("scripts/email_e2e_build.sh"))
}

fn run_scenarios() -> Step<Run> {
    Step::new("run the email end-to-end scenarios").run(include_str!("scripts/email_e2e.sh"))
}

/// The scenarios kept for known, unfixed bugs fail by design, so this step
/// never fails the job: it reports which still fail and which now pass.
fn known_bugs() -> Step<Run> {
    Step::new("report scenarios for known bugs")
        .run(include_str!("scripts/email_e2e_known_bugs.sh"))
        .continue_on_error(true)
}

/// Every scenario's service logs, when the suite failed.
fn upload_logs(name: &str) -> Step<Use> {
    steps::upload_artifact(name, LOGS)
        .add_with(("if-no-files-found", "ignore"))
        .add_with(("retention-days", 7))
        .if_condition(Expression::new("failure()"))
}
