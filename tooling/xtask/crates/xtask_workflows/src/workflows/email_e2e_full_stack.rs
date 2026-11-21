//! `Email end-to-end (full stack)` — the email browser suite's full-stack
//! tier: the built web app in Chromium against one instance of the local
//! stack (`just run_local`), through its real gateway, sign-in and proxy,
//! for the email functions that need services no stack of a test's own runs
//! (`apps/web/tests/email-e2e/README.md`). Generated into
//! `email_e2e_full_stack.yml`.
//!
//! It runs in the daily sweep ([`email_e2e::SWEEP`]) only, with its tests
//! kept for known bugs and its coverage check, and by hand
//! (`workflow_dispatch`). It is not part of `PR CI` and does not run on
//! pushes to `main`: the stack is every service, built from the commit under
//! test. A failure is a red run on that commit; nothing is reverted or
//! blocked by it. Its last job tells the Macro Alerts channel when the sweep
//! turns red, and when it passes again ([`email_e2e_alert`]).

use gh_workflow::expr::typed::{JobHandle, cancelled, failure};
use gh_workflow::{Event, Job, Run, Step, Use, Workflow, WorkflowDispatch};

use crate::workflows::{
    code_check_cloud_storage, email_e2e, email_e2e_alert, runners,
    steps::{self, FluentBuilder},
    vars, web_app_check_main,
};

/// The job that runs the tier.
const TIER_JOB: JobHandle<()> = JobHandle::new("email-e2e-full-stack", ());

/// The artifact the tier uploads its coverage report as.
const COVERAGE_REPORT: &str = "email-e2e-full-stack-coverage";

/// The stack instance the job starts: its own Compose project and ports.
const INSTANCE: &str = "email-e2e";

/// Where the stack's logs are written when a test fails.
const STACK_LOGS: xtask_paths::RuntimePath<'static> =
    xtask_paths::runtime_path!("target/email-e2e-full-stack");

/// Where a failed test leaves its Playwright trace.
const TRACES: xtask_paths::RuntimePath<'static> =
    xtask_paths::runtime_path!("apps/web/tests/email-e2e/test-results");

/// What the coverage report of the email UI writes
/// (`apps/web/tests/email-e2e/ledger/README.md`).
const LEDGER: xtask_paths::RuntimePath<'static> =
    xtask_paths::runtime_path!("apps/web/tests/email-e2e/ledger-results/report");

/// Build the workflow.
pub fn email_e2e_full_stack() -> Workflow {
    Workflow::new("Email end-to-end (full stack)")
        .on(Event::default()
            .add_schedule(email_e2e::sweep())
            .workflow_dispatch(WorkflowDispatch::default()))
        .concurrency(email_e2e::concurrency("email-e2e-full-stack"))
        .map(vars::with_global_env)
        .add_job(TIER_JOB, tier())
        .add_job(
            email_e2e_alert::JOB,
            email_e2e_alert::job(&[&TIER_JOB], COVERAGE_REPORT),
        )
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
        .add_step(steps::reuse_cargo_target())
        .add_step(steps::setup_nix_with_seed())
        .add_step(steps::setup_reqs_web("Setup", true))
        .add_step(steps::configure_namespace_sccache(vars::CI_SCCACHE_NAME))
        .add_step(steps::start_sccache_server())
        .add_step(steps::code_mode_assets())
        .add_step(run_tier())
        .add_step(known_bugs())
        .add_step(ledger())
        .add_step(
            steps::upload_artifact_action(COVERAGE_REPORT, LEDGER)
                .if_no_files_found("ignore")
                .step()
                .if_condition(!cancelled()),
        )
        .add_step(stack_logs())
        .add_step(upload("email-e2e-full-stack-logs", STACK_LOGS))
        .add_step(upload("email-e2e-full-stack-traces", TRACES))
        .add_step(steps::show_sccache_stats())
        .add_step(steps::teardown_nix())
        .add_step(steps::seal_cargo_target())
}

/// Start the stack and run the tests tagged for it.
fn run_tier() -> Step<Run> {
    web_app_check_main::with_pr_wasm_env(
        Step::new("run the full-stack tier").run(include_str!("scripts/email_e2e_full_stack.sh")),
    )
}

/// The tier's tests kept for known, unfixed bugs fail by design, so this
/// step never fails the job: its output says which still fail. One that
/// passes fails the ledger step below, until its tag is removed.
fn known_bugs() -> Step<Run> {
    Step::new("report the tier's tests for known bugs")
        .run(
            "just test-email-e2e-full-stack \"$EMAIL_E2E_INSTANCE\" --pass-with-no-tests \
             --retries 0 --output tests/email-e2e/test-results/known-bugs",
        )
        .add_env(("EMAIL_E2E_KNOWN_BUGS", "1"))
        .working_directory(xtask_paths::repo_dir!("apps/web"))
        .continue_on_error(true)
        .if_condition(!cancelled())
}

/// What the tier covers of the email UI, from what the two runs above
/// recorded: the job summary and the `email-e2e-full-stack-coverage`
/// artifact. It fails the job when something the tier alone covers
/// (`ledger/full-stack-only.tsv`) has no passing test, and when a test for
/// a known bug passes.
fn ledger() -> Step<Run> {
    Step::new("check the tier's coverage of the email UI")
        .run("just email-e2e-ledger --enforce")
        .working_directory(xtask_paths::repo_dir!("apps/web"))
        .if_condition(!cancelled())
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
    steps::upload_artifact_action(name, path)
        .if_no_files_found("ignore")
        .retention_days(7)
        .step()
        .if_condition(failure())
}
