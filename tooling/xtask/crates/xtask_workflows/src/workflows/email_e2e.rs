//! `Email end-to-end` — the `email_e2e` suite: the real `email_service` and
//! its workers against the Gmail and Outlook emulators. Generated into
//! `email_e2e.yml`.
//!
//! It runs on every push to `main` that changes backend code, because a
//! shared crate or a migration can break email as easily as email code can,
//! and in the daily sweep ([`SWEEP`]), which also reports the scenarios kept
//! for known bugs. It is not part of `PR CI`: a pull request branch is run
//! by hand (`workflow_dispatch`, `apps/web/tests/email-e2e/README.md`). A
//! failure on `main` is a red run on the merge commit; nothing is reverted
//! or blocked by it.

use gh_workflow::{
    Concurrency, Container, Env, Event, Expression, Job, Port, Push, Run, Schedule, Step, Use,
    Workflow, WorkflowDispatch, WorkflowDispatchInput,
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
/// also report the tests kept for known bugs. A push to `main` does not.
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

/// Where the suite keeps each scenario's service logs.
const LOGS: xtask_paths::RuntimePath<'static> =
    xtask_paths::runtime_path!("target/debug/email-e2e");

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
        .add_job("email-e2e", suite())
}

/// A run by hand, of any branch. It runs what a push to `main` runs; with
/// `known_bugs` it also reports the tests kept for known bugs, as the sweep
/// does.
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
/// push's run of the same commit.
fn concurrency() -> Concurrency {
    Concurrency::new(Expression::new(
        "email-e2e-${{ github.event_name }}-${{ github.sha }}",
    ))
    .cancel_in_progress(true)
}

/// Build the two services and run the scenarios against Postgres, Redis, an
/// SQS-compatible server and a Kafka broker.
fn suite() -> Job {
    Job::default()
        .name("Email end-to-end")
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
        .add_service("postgres", code_check_cloud_storage::postgres_service())
        .add_service("redis", code_check_cloud_storage::redis_service())
        .add_service("sqs", sqs_service())
        .add_service("kafka", kafka_service())
        .add_step(steps::checkout(false, false))
        .add_step(steps::mount_cache_volume())
        .add_step(steps::setup_nix_with_seed())
        .add_step(steps::setup_dev_shell().timeout_minutes(vars::DEV_SHELL_TIMEOUT_MINUTES))
        .add_step(steps::configure_namespace_sccache(vars::CI_SCCACHE_NAME))
        .add_step(steps::start_sccache_server())
        .add_step(steps::code_mode_assets())
        .add_step(raise_connection_limit())
        .add_step(code_check_cloud_storage::configure_postgres())
        .add_step(run_suite())
        .add_step(known_bugs())
        .add_step(upload_logs())
        .add_step(steps::show_sccache_stats())
        .add_step(steps::teardown_nix())
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

/// Room for every scenario's connection pools.
pub(crate) fn raise_connection_limit() -> Step<Run> {
    Step::new("raise the postgres connection limit")
        .run(include_str!("scripts/email_e2e_postgres.sh"))
}

fn run_suite() -> Step<Run> {
    Step::new("run the email end-to-end suite").run(include_str!("scripts/email_e2e.sh"))
}

/// The scenarios kept for known, unfixed bugs fail by design, so this step
/// never fails the job: it reports which still fail and which now pass. Only
/// where [`REPORTS_KNOWN_BUGS`] holds.
fn known_bugs() -> Step<Run> {
    Step::new("report scenarios for known bugs")
        .run("crates/email_e2e/scripts/known_bugs.sh")
        .continue_on_error(true)
        .if_condition(Expression::new(REPORTS_KNOWN_BUGS))
}

/// Every scenario's service logs, when the suite failed.
fn upload_logs() -> Step<Use> {
    steps::upload_artifact("email-e2e-logs", LOGS)
        .add_with(("if-no-files-found", "ignore"))
        .add_with(("retention-days", 7))
        .if_condition(Expression::new("failure()"))
}
