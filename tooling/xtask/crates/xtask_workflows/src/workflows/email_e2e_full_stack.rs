//! `Email end-to-end (full stack)` — the email browser suite's full-stack
//! tier: the built web app in Chromium against one instance of the local
//! stack (`just run_local`), through its real gateway, sign-in and proxy,
//! for the email functions that need services no stack of a test's own runs
//! (`apps/web/tests/email-e2e/README.md`). Generated into
//! `email_e2e_full_stack.yml`.
//!
//! It runs on every push to `main` that changes what the stack or the web
//! bundle is built from, and nightly. It is not part of `PR CI`: the stack
//! is every service, built from the commit under test. A failure is a red
//! run on that commit; nothing is reverted or blocked by it.

use gh_workflow::{
    Concurrency, Event, Expression, Job, Push, Run, Schedule, Step, Use, Workflow, WorkflowCall,
    WorkflowDispatch,
};
use xtask_paths::RepoGlob;

use crate::workflows::{
    code_check_cloud_storage, runners,
    steps::{self, FluentBuilder},
    vars, web_app_check_main,
};

/// Files whose change on `main` runs the tier: anything the stack's
/// services, its orchestration or the web bundle are built from.
const MAIN_PATHS: &[RepoGlob<'static>] = &[
    xtask_paths::repo_glob!("services/**"),
    xtask_paths::repo_glob!("crates/**"),
    xtask_paths::repo_glob!("apps/web/**"),
    xtask_paths::repo_glob!("packages/**"),
    xtask_paths::repo_glob!("infra/local/**"),
    xtask_paths::repo_glob!("tooling/xtask/crates/xtask_local/**"),
    xtask_paths::repo_glob!("Cargo.toml"),
    xtask_paths::repo_glob!("Cargo.lock"),
    xtask_paths::repo_glob!("bun.lock"),
    xtask_paths::repo_glob!("rust-toolchain.toml"),
    xtask_paths::repo_glob!("flake.nix"),
    xtask_paths::repo_glob!("flake.lock"),
    xtask_paths::repo_glob!(".github/workflows/email_e2e_full_stack.yml"),
];

/// 03:00 UTC, when little else is building.
const NIGHTLY: &str = "0 3 * * *";

/// The stack instance the job starts: its own Compose project and ports.
const INSTANCE: &str = "email-e2e";

/// Where the stack's logs are written when a test fails.
const STACK_LOGS: xtask_paths::RuntimePath<'static> =
    xtask_paths::runtime_path!("target/email-e2e-full-stack");

/// Where a failed test leaves its Playwright trace.
const TRACES: xtask_paths::RuntimePath<'static> =
    xtask_paths::runtime_path!("apps/web/tests/email-e2e/test-results");

/// Build the workflow.
pub fn email_e2e_full_stack() -> Workflow {
    let push = MAIN_PATHS
        .iter()
        .fold(Push::default().add_branch("main"), |push, path| {
            push.add_path(path.as_str())
        });

    Workflow::new("Email end-to-end (full stack)")
        .on(Event::default()
            .push(push)
            .add_schedule(Schedule::new(NIGHTLY))
            .workflow_dispatch(WorkflowDispatch::default())
            .workflow_call(WorkflowCall::default()))
        .concurrency(concurrency())
        .map(vars::with_global_env)
        .add_job("email-e2e-full-stack", tier())
}

/// Every commit on `main` keeps its own result.
fn concurrency() -> Concurrency {
    Concurrency::new(Expression::new(
        "email-e2e-full-stack-${{ github.event_name }}-${{ github.event_name == 'pull_request' && github.run_id || github.sha }}",
    ))
    .cancel_in_progress(true)
}

/// Build the services and the web bundle, start the stack, run the tier.
fn tier() -> Job {
    Job::default()
        .name("Email end-to-end (full stack)")
        .timeout_minutes(45u32)
        .runs_on(runners::Runner::Large.with_cache_tag(vars::CI_CACHE_TAG))
        .map(code_check_cloud_storage::with_test_compile_env)
        .add_env(("SQLX_OFFLINE", "true"))
        .add_env(("SCCACHE_IDLE_TIMEOUT", "0"))
        .add_env(("EMAIL_E2E_INSTANCE", INSTANCE))
        .add_env(("EMAIL_E2E_BROWSER_WORKERS", "4"))
        .add_step(steps::checkout(false, false))
        .add_step(steps::mount_cache_volume())
        .add_step(steps::setup_nix_with_seed())
        .add_step(steps::setup_reqs_web("Setup", true))
        .add_step(steps::configure_namespace_sccache(vars::CI_SCCACHE_NAME))
        .add_step(steps::start_sccache_server())
        .add_step(steps::code_mode_assets())
        .add_step(run_tier())
        .add_step(stack_logs())
        .add_step(upload("email-e2e-full-stack-logs", STACK_LOGS))
        .add_step(upload("email-e2e-full-stack-traces", TRACES))
        .add_step(steps::show_sccache_stats())
        .add_step(steps::teardown_nix())
}

/// Start the stack and run the tests tagged for it.
fn run_tier() -> Step<Run> {
    web_app_check_main::with_pr_wasm_env(
        Step::new("run the full-stack tier").run(include_str!("scripts/email_e2e_full_stack.sh")),
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
        .add_with(("if-no-files-found", "ignore"))
        .add_with(("retention-days", 7))
        .if_condition(Expression::new("failure()"))
}
