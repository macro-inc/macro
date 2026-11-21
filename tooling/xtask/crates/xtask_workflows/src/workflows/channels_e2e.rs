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
use gh_workflow::expr::typed::{Bool, Expr, JobHandle, StepHandle, always, cancelled, failure};

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

/// The artifact every run uploads its Playwright report as, which the alert
/// job reads the failed tests from.
const REPORT_ARTIFACT: &str = "channels-e2e-report";

/// The run's Playwright report.
const REPORT: xtask_paths::RuntimePath<'static> =
    xtask_paths::runtime_path!("apps/web/tests/channels-e2e/.run/playwright-report.json");

/// Minutes the job may take. A warm run takes about 18, one of them before the
/// suite's step.
const JOB_MINUTES: u32 = 45;

/// Minutes the suite's step may take. Less than the job's, so that running out
/// of time fails the step and leaves the job time to collect the stack's logs,
/// upload them and seal the cargo target; a job that runs out of time itself
/// is cancelled, and skips every step that does not ask to run regardless.
const SUITE_MINUTES: u32 = 30;

/// The step that dates the checkout, which the seal depends on.
const REUSE_STEP: StepHandle<()> = StepHandle::new("reuse", ());

/// The stack instance each job starts: its own Compose project and ports.
const INSTANCE: &str = "channels-e2e";

/// Where the stack's logs are written when a test fails.
const STACK_LOGS: xtask_paths::RuntimePath<'static> =
    xtask_paths::runtime_path!("target/channels-e2e");

/// Where a run leaves its report and the traces of its failed tests.
const RESULTS: xtask_paths::RuntimePath<'static> =
    xtask_paths::runtime_path!("apps/web/tests/channels-e2e/.run");

/// A run that failed or was cancelled, which is what a job out of time is.
fn not_green() -> Expr<Bool> {
    failure().or(cancelled())
}

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
        .add_job(SUITE_JOB, suite())
        .add_job(
            email_e2e_alert::JOB,
            email_e2e_alert::job(&[&SUITE_JOB], REPORT_ARTIFACT),
        )
}

/// Build the services and the web app, start the stack, run the suite.
fn suite() -> Job {
    Job::default()
        .name("Channels end-to-end")
        .timeout_minutes(JOB_MINUTES)
        .runs_on(runners::Runner::Large.with_cache_tag(vars::CI_CACHE_TAG))
        .map(code_check_cloud_storage::with_test_compile_env)
        .add_env(("SQLX_OFFLINE", "true"))
        .add_env(("SCCACHE_IDLE_TIMEOUT", "0"))
        .add_env(("CHANNELS_E2E_INSTANCE", INSTANCE))
        .add_step(steps::checkout(false, false))
        .add_step(steps::mount_cache_volume())
        .add_step(steps::reuse_cargo_target().id(REUSE_STEP.id()))
        .add_step(steps::setup_nix_with_seed())
        .add_step(steps::setup_reqs_web("Setup", true))
        .add_step(steps::configure_namespace_sccache(vars::CI_SCCACHE_NAME))
        .add_step(steps::start_sccache_server())
        .add_step(steps::code_mode_assets())
        .add_step(run_suite())
        .add_step(stack_logs())
        .add_step(upload("channels-e2e-stack-logs", STACK_LOGS))
        .add_step(upload("channels-e2e-results", RESULTS))
        .add_step(
            steps::upload_artifact(REPORT_ARTIFACT, REPORT)
                .add_with(("include-hidden-files", true))
                .add_with(("if-no-files-found", "ignore"))
                // A re-run of a failed job uploads under the same name again.
                .add_with(("overwrite", true))
                .add_with(("retention-days", 7))
                .if_condition(always()),
        )
        .add_step(steps::show_sccache_stats())
        .add_step(steps::teardown_nix())
        .add_step(
            // Also after a red or cancelled run: units a job built and did not
            // seal make the next job rebuild every workspace crate, so one
            // slow run would slow the run after it. Only once the checkout
            // was dated, which is what the seal vouches for.
            steps::seal_cargo_target()
                .if_condition(always().and(REUSE_STEP.outcome().eq("success"))),
        )
}

/// Start the stack, seed the suite's people and run the tests.
fn run_suite() -> Step<Run> {
    web_app_check_main::with_pr_wasm_env(
        Step::new("run the channels suite")
            .run(include_str!("scripts/channels_e2e.sh"))
            .timeout_minutes(SUITE_MINUTES),
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
        .if_condition(not_green())
}

fn upload(name: &str, path: xtask_paths::RuntimePath<'static>) -> Step<Use> {
    steps::upload_artifact(name, path)
        // The results are in `.run`, which the action skips as hidden otherwise.
        .add_with(("include-hidden-files", true))
        .add_with(("if-no-files-found", "ignore"))
        .add_with(("retention-days", 7))
        .if_condition(not_green())
}
