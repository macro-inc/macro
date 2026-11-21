//! `Channels end-to-end` — the channels browser suite
//! (`apps/web/tests/channels-e2e`): the built web app in Chromium against
//! one instance of the local stack (`just stack up`), through its real
//! proxy, sign-in, services and gateway, with four people signed in.
//! Generated into `channels_e2e.yml`.
//!
//! It runs as the email end-to-end workflows do (`email_e2e_browser.rs`): on
//! pushes to `main` that change the web app, backend code or what its stack
//! is seeded and started from, one run at a time
//! ([`email_e2e::concurrency`]), and nightly. It is not part of `PR CI`: a
//! pull request branch is run by hand (`workflow_dispatch`,
//! `apps/web/tests/channels-e2e/README.md`). A failure on `main` is a red
//! run on the commit it tested; nothing is reverted or blocked by it. Its
//! last job tells the Macro Alerts channel when the pushes or the nightly
//! runs turn red, and when they pass again ([`email_e2e_alert`]).
//!
//! It runs the suite twice, with the app built with channel local sync off
//! and on: channels read and write through different paths in each. The
//! alert names the failed tests of the build without it, which is what
//! ships; a failure of the other build still turns the run red.
use gh_workflow::expr::typed::{JobHandle, cancelled, failure};

use gh_workflow::{
    Event, Job, Level, Permissions, Push, Run, Schedule, Step, Use, Workflow, WorkflowDispatch,
};
use xtask_paths::RepoGlob;

use crate::workflows::{
    code_check_cloud_storage, email_e2e, email_e2e_alert, runners,
    steps::{self, FluentBuilder},
    vars, web_app_check_main,
};

/// Files whose change on `main` runs the suite: anything the services or the
/// web bundle are built from, and what the stack is seeded and started from.
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
    xtask_paths::repo_glob!("tooling/seed_cli/**"),
    xtask_paths::repo_glob!("tooling/xtask/crates/xtask_local/**"),
    xtask_paths::repo_glob!("tooling/just/**"),
    xtask_paths::repo_glob!("infra/local/**"),
    xtask_paths::repo_glob!("docker/**"),
    xtask_paths::repo_glob!("justfile"),
    xtask_paths::repo_glob!("package.json"),
    xtask_paths::repo_glob!(".github/workflows/channels_e2e.yml"),
];

/// 04:00 UTC, when little else is building.
const NIGHTLY: &str = "0 4 * * *";

/// The job that runs the suite.
const SUITE_JOB: JobHandle<()> = JobHandle::new("suite", ());

/// The job that runs it on the app built with channel local sync.
const LOCAL_SYNC_JOB: JobHandle<()> = JobHandle::new("suite-local-sync-on", ());

/// What the artifacts of the job with channel local sync end in.
const LOCAL_SYNC_SUFFIX: &str = "-local-sync-on";

/// The artifact every run uploads its Playwright report as, which the alert
/// job reads the failed tests from.
const REPORT_ARTIFACT: &str = "channels-e2e-report";

/// The run's Playwright report.
const REPORT: xtask_paths::RuntimePath<'static> =
    xtask_paths::runtime_path!("apps/web/tests/channels-e2e/.run/playwright-report.json");

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
    let push = MAIN_PATHS
        .iter()
        .fold(Push::default().add_branch("main"), |push, path| {
            push.add_path(path.as_str())
        });

    Workflow::new("Channels end-to-end")
        .permissions(Permissions {
            contents: Some(Level::Read),
            ..Default::default()
        })
        .on(Event::default()
            .push(push)
            .add_schedule(Schedule::new(NIGHTLY))
            .workflow_dispatch(WorkflowDispatch::default()))
        .concurrency(email_e2e::concurrency("channels-e2e"))
        .map(vars::with_global_env)
        .add_job(SUITE_JOB, suite("off", "false", ""))
        .add_job(LOCAL_SYNC_JOB, suite("on", "true", LOCAL_SYNC_SUFFIX))
        .add_job(
            email_e2e_alert::JOB,
            email_e2e_alert::job(&[&SUITE_JOB, &LOCAL_SYNC_JOB], REPORT_ARTIFACT),
        )
}

/// Build the services and the web app, start the stack, run the suite.
/// `local_sync` is the value the app is built with for
/// `VITE_ENABLE_CHANNEL_LOCAL_SYNC`, which keeps channels on the device and has
/// no default; `suffix` keeps the two jobs' artifacts apart.
fn suite(label: &str, local_sync: &str, suffix: &str) -> Job {
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
        .add_step(steps::reuse_cargo_target())
        .add_step(steps::setup_nix_with_seed())
        .add_step(steps::setup_reqs_web("Setup", true))
        .add_step(steps::configure_namespace_sccache(vars::CI_SCCACHE_NAME))
        .add_step(steps::start_sccache_server())
        .add_step(steps::code_mode_assets())
        .add_step(run_suite())
        .add_step(stack_logs())
        .add_step(upload(
            &format!("channels-e2e-stack-logs{suffix}"),
            STACK_LOGS,
        ))
        .add_step(upload(&format!("channels-e2e-results{suffix}"), RESULTS))
        .add_step(
            steps::upload_artifact(&format!("{REPORT_ARTIFACT}{suffix}"), REPORT)
                .add_with(("include-hidden-files", true))
                .add_with(("if-no-files-found", "ignore"))
                // A re-run of a failed job uploads under the same name again.
                .add_with(("overwrite", true))
                .add_with(("retention-days", 7))
                .if_condition(!cancelled()),
        )
        .add_step(steps::show_sccache_stats())
        .add_step(steps::teardown_nix())
        .add_step(steps::seal_cargo_target())
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
        .if_condition(failure())
}

fn upload(name: &str, path: xtask_paths::RuntimePath<'static>) -> Step<Use> {
    steps::upload_artifact(name, path)
        // The results are in `.run`, which the action skips as hidden otherwise.
        .add_with(("include-hidden-files", true))
        .add_with(("if-no-files-found", "ignore"))
        .add_with(("retention-days", 7))
        .if_condition(failure())
}
