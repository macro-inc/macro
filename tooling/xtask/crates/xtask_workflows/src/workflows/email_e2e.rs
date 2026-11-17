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
//! and in the daily sweep ([`SWEEP`]), which also runs the scenarios kept
//! for known bugs, as a run by hand with `known_bugs` does. It is not part
//! of `PR CI`: a pull request branch is run by hand (`workflow_dispatch`,
//! `crates/email_e2e/AGENTS.md`).
//! A failure on `main` is a red run on the merge commit; nothing is reverted
//! or blocked by it.

use gh_workflow::{
    Concurrency, Container, Env, Event, Expression, Job, Port, Push, Run, Schedule, Step, Strategy,
    Use, Workflow, WorkflowDispatch, WorkflowDispatchInput,
};
use std::collections::HashMap;

use xtask_paths::RepoGlob;

use crate::workflows::{
    code_check_cloud_storage, runners,
    steps::{self, FluentBuilder},
    vars,
};

/// The daily sweep of the three email end-to-end workflows: 21:00 UTC. Cron
/// is UTC and does not follow daylight saving, so this is 4pm EST and 5pm
/// EDT.
pub(crate) const SWEEP: &str = "0 21 * * *";

/// The comment the generated files carry above [`SWEEP`].
const SWEEP_NOTE: &str = "# cron is UTC: 21:00 UTC is 4pm EST and 5pm EDT.";

/// The `workflow_dispatch` input that asks for the known-bug report too.
const KNOWN_BUGS_INPUT: &str = "known_bugs";

/// True in the sweep, and in a run by hand that asked for it: the runs that
/// also run and report the scenarios kept for known bugs. A push to `main`
/// does not.
pub(crate) const REPORTS_KNOWN_BUGS: &str =
    "github.event_name == 'schedule' || inputs.known_bugs == true";

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

/// The jobs the coverage job reads the results of, by id.
const REPORTED_JOBS: [&str; 3] = ["email-e2e", "email-e2e-search", "email-e2e-known-bugs"];

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
            .add_schedule(Schedule::new(SWEEP))
            .workflow_dispatch(dispatch()))
        .concurrency(concurrency())
        .map(vars::with_global_env)
        .add_job("email-e2e", scenarios())
        .add_job("email-e2e-search", search())
        .add_job("email-e2e-known-bugs", known_bug_scenarios())
        .add_job("email-e2e-coverage", coverage())
}

/// A run by hand, of any branch. It runs what a push to `main` runs; with
/// `known_bugs` it also runs and reports the scenarios kept for known bugs,
/// as the sweep does.
pub(crate) fn dispatch() -> WorkflowDispatch {
    WorkflowDispatch {
        inputs: HashMap::from([(
            KNOWN_BUGS_INPUT.to_string(),
            WorkflowDispatchInput {
                description: "Also report the tests kept for known bugs, as the daily sweep does"
                    .into(),
                required: false,
                input_type: "boolean".into(),
                default: None,
            },
        )]),
    }
}

/// Render one of the email end-to-end workflows, with [`SWEEP_NOTE`] above
/// its schedule: the YAML model has no comments.
pub(crate) fn render(build: fn() -> Workflow) -> anyhow::Result<String> {
    let yaml = build().to_string().map_err(|e| anyhow::anyhow!("{e:?}"))?;
    let cron = format!("- cron: '{SWEEP}'");
    let mut noted = false;
    let lines: Vec<String> = yaml
        .lines()
        .flat_map(|line| {
            let indent = line.len() - line.trim_start().len();
            if line.trim_start() == cron {
                noted = true;
                vec![
                    format!("{}{SWEEP_NOTE}", " ".repeat(indent)),
                    line.to_string(),
                ]
            } else {
                vec![line.to_string()]
            }
        })
        .collect();
    anyhow::ensure!(noted, "the workflow has no `{cron}` to put the note above");
    Ok(lines.join("\n") + "\n")
}

/// Every commit on `main` gets its own result: a later merge does not cancel
/// the run of an earlier one, so a break can be traced to its commit. The
/// event is in the group so the sweep and a run by hand do not cancel the
/// push's run of the same commit; runs by hand never cancel each other.
fn concurrency() -> Concurrency {
    Concurrency::new(Expression::new(
        "email-e2e-${{ github.event_name }}-${{ github.event_name == 'workflow_dispatch' && github.run_id || github.sha }}",
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

/// The search scenarios, with OpenSearch and the indexer, and, where
/// [`REPORTS_KNOWN_BUGS`] holds, the search scenarios kept for known bugs.
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
        .map(|job| keep_known_bug_results(job, "email-e2e-known-bugs-search"))
        .map(|job| finish(job, "email-e2e-logs-search"))
}

/// The scenarios kept for known, unfixed bugs, outside search. They fail by
/// design and several wait out a timeout, so they have a job of their own
/// that never fails for a scenario: it reports which still fail and which
/// now pass, and keeps the results for the coverage job, which fails for
/// one that passes. Only where [`REPORTS_KNOWN_BUGS`] holds.
fn known_bug_scenarios() -> Job {
    job("Email end-to-end (known bugs)")
        .cond(Expression::new(REPORTS_KNOWN_BUGS))
        .add_env(("EMAIL_E2E_SCENARIOS", WITHOUT_SEARCH))
        .map(prepare)
        .add_step(known_bugs())
        .map(|job| keep_known_bug_results(job, "email-e2e-known-bugs-rest"))
        .add_step(steps::show_sccache_stats())
        .add_step(steps::teardown_nix())
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
        .needs(REPORTED_JOBS.map(str::to_owned).to_vec())
        .cond(Expression::new("always()"))
        .add_env(("EMAIL_E2E_RESULTS", RESULTS.as_str()))
        .add_env(("EMAIL_E2E_KNOWN_BUGS", KNOWN_BUGS.as_str()))
        .add_env((
            "EMAIL_E2E_REPORT_KNOWN_BUGS",
            format!("${{{{ {REPORTS_KNOWN_BUGS} }}}}"),
        ))
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
            Step::new("download the results of the scenarios for known bugs")
                .uses(
                    "actions",
                    "download-artifact",
                    "634f93cb2916e3fdff6788551b99b062d0335ce0",
                ) // v5
                .add_with(("pattern", "email-e2e-known-bugs-*"))
                .add_with(("path", KNOWN_BUGS.as_str()))
                .if_condition(Expression::new(REPORTS_KNOWN_BUGS)),
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

/// Keeps the results of the run of the scenarios for known bugs for the
/// coverage job, in the runs that have one.
fn keep_known_bug_results(job: Job, name: &str) -> Job {
    job.add_step(
        Step::new("keep the results of the scenarios for known bugs")
            .run(include_str!("scripts/email_e2e_known_bug_results.sh"))
            .if_condition(with_known_bugs("always()")),
    )
    .add_step(
        steps::upload_artifact(name, KNOWN_BUGS)
            .add_with(("if-no-files-found", "ignore"))
            .add_with(("retention-days", 7))
            .if_condition(with_known_bugs("always()")),
    )
}

/// ElasticMQ: the SQS-compatible server the scenarios' queues live on.
pub(crate) fn sqs_service() -> Container {
    Container::default()
        .image("softwaremill/elasticmq-native:1.7.1")
        .ports(vec![Port::Name("9324:9324".to_string())])
}

/// A single-node Kafka, the version the local stack runs. The services only
/// publish to it.
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
pub(crate) fn raise_connection_limit() -> Step<Run> {
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
/// never fails the job: it reports which still fail and which now pass. Only
/// where [`REPORTS_KNOWN_BUGS`] holds, and also after a failed step: in the
/// search job it follows the gating scenarios, and the coverage job needs its
/// results.
fn known_bugs() -> Step<Run> {
    Step::new("report scenarios for known bugs")
        .run(include_str!("scripts/email_e2e_known_bugs.sh"))
        .continue_on_error(true)
        .if_condition(with_known_bugs("!cancelled()"))
}

/// `when`, in a run where [`REPORTS_KNOWN_BUGS`] holds.
fn with_known_bugs(when: &str) -> Expression {
    Expression::new(format!("{when} && ({REPORTS_KNOWN_BUGS})"))
}

/// Every scenario's service logs, when the suite failed.
fn upload_logs(name: &str) -> Step<Use> {
    steps::upload_artifact(name, LOGS)
        .add_with(("if-no-files-found", "ignore"))
        .add_with(("retention-days", 7))
        .if_condition(Expression::new("failure()"))
}
