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
//! It runs on pushes to `main` that change backend code, one run at a time
//! ([`concurrency`]), because a shared crate or a migration can break email
//! as easily as email code can, and in the daily sweep ([`SWEEP`]), which
//! also runs the scenarios kept for known bugs, as a run by hand with
//! `known_bugs` does. It is not part of `PR CI`: a pull request branch is run
//! by hand (`workflow_dispatch`, `crates/email_e2e/AGENTS.md`).
//! A failure on `main` is a red run on the commit it tested; nothing is
//! reverted or blocked by it. Its last job tells the Macro Alerts channel
//! when the pushes or the sweep turn red, and when they pass again
//! ([`email_e2e_alert`]).

use gh_workflow::expr::typed::{
    Bool, Expr, JobHandle, Num, Str, always, cancelled, failure, format, github, input, matrix,
};
use gh_workflow::{
    Concurrency, Container, Env, Event, Job, Port, Push, Run, Schedule, Step, Strategy, Use,
    Workflow, WorkflowDispatch, WorkflowInput,
};

use xtask_paths::RepoGlob;

use crate::workflows::actions::ActionsDownloadArtifact;
use crate::workflows::{
    code_check_cloud_storage, email_e2e_alert, runners,
    steps::{self, FluentBuilder},
    vars,
};

/// The daily sweep of the three email end-to-end workflows: 21:00 UTC. Cron
/// is UTC and does not follow daylight saving, so this is 4pm EST and 5pm
/// EDT.
pub(crate) const SWEEP: &str = "0 21 * * *";

/// The comment the generated files carry on the [`SWEEP`] line.
const SWEEP_NOTE: &str = "cron is UTC: 21:00 UTC is 4pm EST and 5pm EDT.";

/// The [`SWEEP`] schedule, noting its local time.
pub(crate) fn sweep() -> Schedule {
    Schedule::new(SWEEP).comment(SWEEP_NOTE)
}

/// The `workflow_dispatch` input that asks for the known-bug report too.
const KNOWN_BUGS_INPUT: &str = "known_bugs";

/// True in the sweep, and in a run by hand that asked for it: the runs that
/// also run and report the scenarios kept for known bugs. A push to `main`
/// does not.
pub(crate) fn reports_known_bugs() -> Expr<Bool> {
    github()
        .event_name()
        .eq("schedule")
        .or(input::<Bool>(KNOWN_BUGS_INPUT).eq(true))
}

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

/// Where a job keeps the results of its run of the scenarios for known
/// bugs, for the coverage job.
const KNOWN_BUGS: xtask_paths::RuntimePath<'static> =
    xtask_paths::runtime_path!("target/email-e2e-known-bugs");

/// Where the coverage job writes its report.
const COVERAGE: xtask_paths::RuntimePath<'static> =
    xtask_paths::runtime_path!("target/email-e2e-coverage");

/// The scenarios without search.
const SCENARIOS: JobHandle<()> = JobHandle::new("email-e2e", ());

/// The search scenarios.
const SEARCH_SCENARIOS: JobHandle<()> = JobHandle::new("email-e2e-search", ());

/// The scenarios kept for known bugs, outside search.
const KNOWN_BUG_SCENARIOS: JobHandle<()> = JobHandle::new("email-e2e-known-bugs", ());

/// The jobs the coverage job reads the results of.
const REPORTED_JOBS: [&JobHandle<()>; 3] = [&SCENARIOS, &SEARCH_SCENARIOS, &KNOWN_BUG_SCENARIOS];

/// The coverage job.
const COVERAGE_JOB: JobHandle<()> = JobHandle::new("email-e2e-coverage", ());

/// The artifact the coverage job uploads its report as.
const COVERAGE_REPORT: &str = "email-e2e-coverage";

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
            .add_schedule(sweep())
            .workflow_dispatch(dispatch()))
        .concurrency(concurrency("email-e2e"))
        .map(vars::with_global_env)
        .add_job(SCENARIOS, scenarios())
        .add_job(SEARCH_SCENARIOS, search())
        .add_job(KNOWN_BUG_SCENARIOS, known_bug_scenarios())
        .add_job(COVERAGE_JOB, coverage())
        .add_job(
            email_e2e_alert::JOB,
            email_e2e_alert::job(
                &[REPORTED_JOBS.as_slice(), &[&COVERAGE_JOB]].concat(),
                COVERAGE_REPORT,
            ),
        )
}

/// A run by hand, of any branch. It runs what a push to `main` runs; with
/// `known_bugs` it also runs and reports the scenarios kept for known bugs,
/// as the sweep does.
pub(crate) fn dispatch() -> WorkflowDispatch {
    WorkflowDispatch::default().add_input(
        KNOWN_BUGS_INPUT,
        WorkflowInput::boolean()
            .description("Also report the tests kept for known bugs, as the daily sweep does"),
    )
}

/// The part of an email end-to-end workflow's concurrency group after its
/// name: one group for each event and branch, and one for each run by hand and
/// each re-run.
fn queue() -> Expr<Str> {
    github()
        .event_name()
        .eq("workflow_dispatch")
        .or(github().run_attempt().ne("1"))
        .then_else(
            github().run_id(),
            format(
                "{0}-{1}",
                [
                    github().event_name().into_ast(),
                    github().git_ref().into_ast(),
                ],
            ),
        )
}

/// The runs of the email end-to-end workflow `name` queue as the dev deploys
/// do: one at a time for each event and branch, the one running never
/// cancelled. Of the pushes to `main` that come meanwhile only the newest
/// waits, replacing (cancelling) the one that waited before it; its run tests
/// the newer tree, so a replaced commit is tested with the commits after it.
/// The sweep has its own group, so a push never replaces it, and a run by
/// hand neither waits for nor replaces another. Nor does a re-run: in the
/// queue it would replace the push waiting and test an older commit in its
/// place, leaving the commit pushed untested until the next push.
pub(crate) fn concurrency(name: &str) -> Concurrency {
    Concurrency::new(format!("{name}-{}", queue())).cancel_in_progress(false)
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
        .add_env(("EMAIL_E2E_KNOWN_BUGS", KNOWN_BUGS.as_str()))
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
        .add_step(steps::reuse_cargo_target())
        .add_step(steps::setup_nix_with_seed())
        .add_step(steps::setup_dev_shell().timeout_minutes(vars::DEV_SHELL_TIMEOUT_MINUTES))
        .add_step(steps::configure_namespace_sccache(vars::CI_SCCACHE_NAME))
        .add_step(steps::start_sccache_server())
        .add_step(steps::code_mode_assets())
        .add_step(raise_connection_limit(600))
        .add_step(code_check_cloud_storage::configure_postgres())
        .add_step(build_services())
}

/// The steps after the scenarios.
fn finish(job: Job, logs: &str) -> Job {
    job.add_step(upload_logs(logs))
        .add_step(steps::show_sccache_stats())
        .add_step(steps::teardown_nix())
        .add_step(steps::seal_cargo_target())
}

/// The scenarios that need no search cluster, divided over [`PARTITIONS`]
/// jobs that run side by side.
fn scenarios() -> Job {
    let parts: Vec<u8> = (1..=PARTITIONS).collect();
    let partition = || matrix::<Num>("partition");
    job(&format!("Email end-to-end ({}/{PARTITIONS})", partition()))
        // A failure in one part says nothing about the others: let them finish.
        .strategy(Strategy {
            matrix: Some(serde_json::json!({ "partition": parts })),
            fail_fast: Some(false),
            max_parallel: None,
        })
        .add_env(("EMAIL_E2E_SCENARIOS", WITHOUT_SEARCH))
        .add_env((
            "EMAIL_E2E_PARTITION",
            format!("slice:{}/{PARTITIONS}", partition()),
        ))
        .map(prepare)
        .add_step(run_scenarios())
        .map(|job| keep_results(job, &format!("email-e2e-results-{}", partition())))
        .map(|job| finish(job, &format!("email-e2e-logs-{}", partition())))
}

/// The search scenarios, with OpenSearch and the indexer, and, where
/// [`reports_known_bugs`] holds, the search scenarios kept for known bugs.
fn search() -> Job {
    job("Email end-to-end (search)")
        .add_env(("EMAIL_E2E_OPENSEARCH_URL", steps::SEARCH_OPENSEARCH_URL))
        .add_env(("EMAIL_E2E_SCENARIOS", SEARCH))
        .add_env(("EMAIL_E2E_BUILD_INDEXER", "true"))
        // Started first, so it is up by the time the services are built.
        .add_step(steps::start_opensearch())
        .map(prepare)
        .add_step(steps::create_search_indices())
        .add_step(run_scenarios())
        .map(|job| keep_results(job, "email-e2e-results-search"))
        .add_step(known_bugs())
        .map(|job| keep_known_bug_results(job, "email-e2e-known-bugs-search"))
        .map(|job| finish(job, "email-e2e-logs-search"))
}

/// The scenarios kept for known, unfixed bugs, outside search. They fail by
/// design and several wait out a timeout, so they have a job of their own
/// that never fails for a scenario: it reports which still fail and which
/// now pass, and keeps the results for the coverage job, which fails for
/// one that passes. Only where [`reports_known_bugs`] holds.
fn known_bug_scenarios() -> Job {
    job("Email end-to-end (known bugs)")
        .cond(reports_known_bugs())
        .add_env(("EMAIL_E2E_SCENARIOS", WITHOUT_SEARCH))
        .map(prepare)
        .add_step(known_bugs())
        .map(|job| keep_known_bug_results(job, "email-e2e-known-bugs-rest"))
        .add_step(steps::show_sccache_stats())
        .add_step(steps::teardown_nix())
        .add_step(steps::seal_cargo_target())
}

/// Reports what the gating scenarios cover, from the records the jobs kept,
/// and fails on a gap: a scenario that failed, a function that is not proved
/// and not waived, an entry point that is not reached and not waived, a
/// scenario kept for a known bug that passes (in the runs that have them),
/// or a list that no longer matches the code. It runs when scenarios failed
/// too: the report says which.
fn coverage() -> Job {
    Job::default()
        .name("Email end-to-end (coverage)")
        .timeout_minutes(15u32)
        .runs_on(runners::Runner::Small.to_string())
        .needs(REPORTED_JOBS.map(|job| job.to_string()).to_vec())
        .cond(always())
        .add_env(("EMAIL_E2E_RESULTS", RESULTS.as_str()))
        .add_env(("EMAIL_E2E_KNOWN_BUGS", KNOWN_BUGS.as_str()))
        .add_env(("EMAIL_E2E_REPORT_KNOWN_BUGS", reports_known_bugs()))
        .add_env(("EMAIL_E2E_COVERAGE", COVERAGE.as_str()))
        .add_step(steps::checkout(false, false))
        .add_step(steps::setup_rust_light())
        .add_step(
            ActionsDownloadArtifact::new("download the scenarios' records")
                .pattern("email-e2e-results-*")
                .path(RESULTS.as_str())
                .step(),
        )
        .add_step(
            ActionsDownloadArtifact::new("download the results of the scenarios for known bugs")
                .pattern("email-e2e-known-bugs-*")
                .path(KNOWN_BUGS.as_str())
                .step()
                .if_condition(reports_known_bugs()),
        )
        .add_step(
            Step::new("report the coverage").run(include_str!("scripts/email_e2e_coverage.sh")),
        )
        .add_step(
            steps::upload_artifact_action(COVERAGE_REPORT, COVERAGE)
                .if_no_files_found("ignore")
                .step()
                .if_condition(always()),
        )
}

/// Keeps the run's results and the scenarios' records for the coverage job,
/// whether or not the scenarios passed.
fn keep_results(job: Job, name: &str) -> Job {
    job.add_step(
        Step::new("keep the results for the coverage report")
            .run(include_str!("scripts/email_e2e_results.sh"))
            .if_condition(always()),
    )
    .add_step(
        steps::upload_artifact_action(name, RESULTS)
            .if_no_files_found("ignore")
            .retention_days(7)
            .step()
            .if_condition(always()),
    )
}

/// Keeps the results of the run of the scenarios for known bugs for the
/// coverage job, in the runs that have one.
fn keep_known_bug_results(job: Job, name: &str) -> Job {
    job.add_step(
        Step::new("keep the results of the scenarios for known bugs")
            .run(include_str!("scripts/email_e2e_known_bug_results.sh"))
            .if_condition(with_known_bugs(always())),
    )
    .add_step(
        steps::upload_artifact_action(name, KNOWN_BUGS)
            .if_no_files_found("ignore")
            .retention_days(7)
            .step()
            .if_condition(with_known_bugs(always())),
    )
}

/// ElasticMQ: the SQS-compatible server the scenarios' queues live on.
pub(crate) fn sqs_service() -> Container {
    Container::default()
        .image("softwaremill/elasticmq-native:1.7.1")
        .ports(vec![Port::Name("9324:9324".to_string())])
}

/// A single-node Kafka, the version the local stack runs. Its
/// `__consumer_offsets` has one partition, not 50: the broker creates that
/// topic when the first consumer group asks for it and serves no topic
/// created after until its partitions exist, which for 50 took a runner 15
/// to 18 seconds.
pub(crate) fn kafka_service() -> Container {
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
                .add("KAFKA_OFFSETS_TOPIC_NUM_PARTITIONS", "1")
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

/// Room for every scenario's connection pools.
pub(crate) fn raise_connection_limit(max_connections: u32) -> Step<Run> {
    Step::new("raise the postgres connection limit")
        .run(include_str!("scripts/email_e2e_postgres.sh"))
        .add_env(("POSTGRES_MAX_CONNECTIONS", max_connections.to_string()))
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
/// never fails the job: it reports which still fail and which now pass. Only
/// where [`reports_known_bugs`] holds, and also after a failed step: in the
/// search job it follows the gating scenarios, and the coverage job needs its
/// results.
fn known_bugs() -> Step<Run> {
    Step::new("report scenarios for known bugs")
        .run(include_str!("scripts/email_e2e_known_bugs.sh"))
        .continue_on_error(true)
        .if_condition(with_known_bugs(!cancelled()))
}

/// `when`, in a run where [`reports_known_bugs`] holds.
fn with_known_bugs(when: Expr<Bool>) -> Expr<Bool> {
    when.and(reports_known_bugs())
}

/// Every scenario's service logs, when the suite failed.
fn upload_logs(name: &str) -> Step<Use> {
    steps::upload_artifact_action(name, LOGS)
        .if_no_files_found("ignore")
        .retention_days(7)
        .step()
        .if_condition(failure())
}
