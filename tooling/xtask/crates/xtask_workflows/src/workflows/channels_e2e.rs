//! `Channels end-to-end` — the channels browser suite
//! (`apps/web/tests/channels-e2e`): the built web app in Chromium against
//! one instance of the local stack (`just stack up`), through its real
//! proxy, sign-in, services and gateway, with four people signed in.
//! Generated into `channels_e2e.yml`.
//!
//! `PR CI` calls it for pull requests that change channels, the suite or
//! what its stack is seeded and started from; it also runs nightly on
//! `main`, because the services under a channel change without the channel
//! code changing. It runs the suite twice, with the app built with the
//! channel local sync off and on: channels read and write through different
//! paths in each.

use gh_workflow::{
    Concurrency, Event, Expression, Job, Level, Permissions, Run, Schedule, Step, Use, Workflow,
    WorkflowCall, WorkflowDispatch,
};
use xtask_paths::RepoGlob;

use crate::workflows::{
    code_check_cloud_storage, runners,
    steps::{self, FluentBuilder},
    vars, web_app_check_main,
};

/// Files whose change makes `PR CI` call this workflow.
pub const PATHS: &[RepoGlob<'static>] = &[
    xtask_paths::repo_glob!("apps/web/tests/channels-e2e/**"),
    xtask_paths::repo_glob!("apps/web/src/features/channel/**"),
    xtask_paths::repo_glob!("apps/web/src/lib/queries/messages/**"),
    xtask_paths::repo_glob!("apps/web/src/lib/queries/channel/**"),
    xtask_paths::repo_glob!("tooling/seed_cli/seed/scenarios/channels-e2e.json"),
    xtask_paths::repo_glob!("apps/web/justfile"),
    xtask_paths::repo_glob!("tooling/xtask/crates/xtask_local/**"),
    xtask_paths::repo_glob!(
        "tooling/xtask/crates/xtask_workflows/src/workflows/scripts/channels_e2e.sh"
    ),
    xtask_paths::repo_glob!(".github/workflows/channels_e2e.yml"),
];

/// 04:00 UTC, when little else is building.
const NIGHTLY: &str = "0 4 * * *";

/// The stack instance each job starts: its own Compose project and ports.
const INSTANCE: &str = "channels-e2e";

/// Where the stack's logs are written when a test fails.
const STACK_LOGS: xtask_paths::RuntimePath<'static> =
    xtask_paths::runtime_path!("target/channels-e2e");

/// Where a run leaves its report and the traces of its failed tests.
const RESULTS: xtask_paths::RuntimePath<'static> =
    xtask_paths::runtime_path!("apps/web/tests/channels-e2e/.run");

/// Build the workflow.
pub fn channels_e2e() -> Workflow {
    Workflow::new("Channels end-to-end")
        .permissions(Permissions {
            contents: Some(Level::Read),
            ..Default::default()
        })
        .on(Event::default()
            .add_schedule(Schedule::new(NIGHTLY))
            .workflow_dispatch(WorkflowDispatch::default())
            .workflow_call(WorkflowCall::default()))
        .concurrency(
            Concurrency::new(Expression::new(
                "channels-e2e-${{ github.event_name }}-${{ github.event.pull_request.number || github.sha }}",
            ))
            .cancel_in_progress(true),
        )
        .map(vars::with_global_env)
        .add_job("local-sync-off", suite("off", "false"))
        .add_job("local-sync-on", suite("on", "true"))
}

/// Build the services and the web app, start the stack, run the suite.
/// `local_sync` is the value the app is built with for
/// `VITE_ENABLE_CHANNEL_LOCAL_SYNC`, which keeps channels on the device and has
/// no default.
fn suite(label: &str, local_sync: &str) -> Job {
    Job::default()
        .name(format!("Channels end-to-end (channel local sync {label})"))
        .timeout_minutes(45u32)
        .runs_on(runners::Runner::Large.with_cache_tag(vars::CI_CACHE_TAG))
        .map(code_check_cloud_storage::with_test_compile_env)
        .add_env(("SQLX_OFFLINE", "true"))
        .add_env(("SCCACHE_IDLE_TIMEOUT", "0"))
        .add_env(("CHANNELS_E2E_INSTANCE", INSTANCE))
        .add_env(("VITE_ENABLE_CHANNEL_LOCAL_SYNC", local_sync))
        .add_step(steps::checkout(false, false))
        .add_step(steps::mount_cache_volume())
        .add_step(steps::setup_nix_with_seed())
        .add_step(steps::setup_reqs_web("Setup", true))
        .add_step(steps::configure_namespace_sccache(vars::CI_SCCACHE_NAME))
        .add_step(steps::start_sccache_server())
        .add_step(steps::code_mode_assets())
        .add_step(run_suite())
        .add_step(stack_logs())
        .add_step(upload(
            &format!("channels-e2e-{label}-stack-logs"),
            STACK_LOGS,
        ))
        .add_step(upload(&format!("channels-e2e-{label}-results"), RESULTS))
        .add_step(steps::show_sccache_stats())
        .add_step(steps::teardown_nix())
}

/// Start the stack, seed the suite's people and run the tests.
fn run_suite() -> Step<Run> {
    web_app_check_main::with_pr_wasm_env(
        Step::new("run the channels suite").run(include_str!("scripts/channels_e2e.sh")),
    )
}

/// What every container of the stack logged, and how its start went.
fn stack_logs() -> Step<Run> {
    Step::new("collect the stack's logs")
        .run(format!(
            "mkdir -p {logs}\n\
             docker compose -p macro-{INSTANCE} logs --no-color > {logs}/containers.log 2>&1 || true\n\
             cp infra/local/generated/{INSTANCE}/run/*.log {logs}/ 2>/dev/null || true",
            logs = STACK_LOGS.as_str(),
        ))
        .if_condition(Expression::new("failure()"))
}

fn upload(name: &str, path: xtask_paths::RuntimePath<'static>) -> Step<Use> {
    steps::upload_artifact(name, path)
        // The results are in `.run`, which the action skips as hidden otherwise.
        .add_with(("include-hidden-files", true))
        .add_with(("if-no-files-found", "ignore"))
        .add_with(("retention-days", 7))
        .if_condition(Expression::new("failure()"))
}
