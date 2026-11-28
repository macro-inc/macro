//! `Chat scale` — the nightly Chat scale tier (`apps/web/tests/chat-scale`):
//! the built web app in Chromium opening Chat over 3,500 and 7,000 joined
//! channels, served from a deterministic fixture with no backend,
//! measuring the page's heap after a forced collection, long tasks and DOM
//! size against loose limits. Generated into `chat_scale.yml`.
//!
//! It runs nightly and by hand (`workflow_dispatch`), one run at a time
//! ([`email_e2e::concurrency`]), and is not part of `PR CI`.
//! A failure is a red run on the commit it tested; nothing is reverted or
//! blocked by it. Its last job tells the Macro Alerts channel when the
//! nightly runs turn red, and when they pass again ([`email_e2e_alert`]).
use gh_workflow::expr::typed::{JobHandle, always};
use gh_workflow::{
    Event, Job, Level, Permissions, Run, Schedule, Step, Workflow, WorkflowDispatch,
};

use crate::workflows::{
    email_e2e, email_e2e_alert, runners,
    steps::{self, FluentBuilder},
    vars, web_app_check_main,
};

/// 05:30 UTC, between the connectors suite's 05:00 run and the CAPTCHA
/// lab's 06:00 one.
const NIGHTLY: &str = "30 5 * * *";

/// The job that runs the tier.
const SUITE_JOB: JobHandle<()> = JobHandle::new("chat-scale", ());

/// The artifact every run uploads the tier's run directory as: the
/// measurements, a failed size's screenshot and requests, and the Playwright
/// report the alert job reads the failed tests from.
const REPORT_ARTIFACT: &str = "chat-scale-report";

/// What a run leaves (`tests/chat-scale/playwright.config.ts`).
const RUN_DIR: xtask_paths::RuntimePath<'static> =
    xtask_paths::runtime_path!("apps/web/.cache/chat-scale");

/// Minutes the job may take: building the bundle, then about four minutes of
/// tests on a developer machine.
const JOB_MINUTES: u32 = 45;

/// Minutes the tier's step may take, less than the job's so a slow run still
/// uploads what it measured.
const SUITE_MINUTES: u32 = 25;

/// Build the workflow.
pub fn chat_scale() -> Workflow {
    Workflow::new("Chat scale")
        .permissions(Permissions {
            contents: Some(Level::Read),
            ..Default::default()
        })
        .on(Event::default()
            .add_schedule(Schedule::new(NIGHTLY))
            .workflow_dispatch(WorkflowDispatch::default()))
        .concurrency(email_e2e::concurrency("chat-scale"))
        .map(vars::with_global_env)
        .add_job(SUITE_JOB, suite())
        .add_job(
            email_e2e_alert::JOB,
            email_e2e_alert::job(&[&SUITE_JOB], REPORT_ARTIFACT),
        )
}

/// Build the bundle, then measure Chat at both sizes. The runner and cache
/// volume are the web checks' (`web_app_check_main.rs`).
fn suite() -> Job {
    Job::default()
        .name("Chat scale")
        .timeout_minutes(JOB_MINUTES)
        .runs_on(runners::Runner::Mid.with_cache_tag(vars::WEB_CI_CACHE_TAG))
        .add_step(steps::checkout(false, false))
        // Not the PR-written node_modules (`only_pr_checks_mount_the_node_modules_volume`).
        .add_step(steps::mount_web_build_check_cache_volume(false))
        .add_step(steps::setup_nix_with_seed())
        .add_step(steps::setup_reqs_web("Setup", true))
        .add_step(steps::configure_namespace_sccache(vars::WEB_SCCACHE_NAME))
        .add_step(steps::start_sccache_server())
        .add_step(build())
        .add_step(run_tier())
        .add_step(summary())
        .add_step(
            steps::upload_artifact(REPORT_ARTIFACT, RUN_DIR)
                // The run directory is under `.cache`, which the action skips
                // as hidden otherwise.
                .add_with(("include-hidden-files", true))
                .add_with(("if-no-files-found", "ignore"))
                // A re-run of a failed job uploads under the same name again.
                .add_with(("overwrite", true))
                .add_with(("retention-days", 14))
                .if_condition(always()),
        )
        .add_step(steps::show_sccache_stats())
        .add_step(steps::teardown_nix())
}

/// The production bundle the tier serves (`just build-chat-scale`).
fn build() -> Step<Run> {
    web_app_check_main::with_pr_wasm_env(
        Step::new("build the Chat scale bundle")
            .run("just build-chat-scale")
            .working_directory(xtask_paths::repo_dir!("apps/web")),
    )
}

fn run_tier() -> Step<Run> {
    Step::new("measure Chat at 3,500 and 7,000 channels")
        .run("bunx playwright install-deps chromium\njust test-chat-scale-browser")
        .working_directory(xtask_paths::repo_dir!("apps/web"))
        .timeout_minutes(SUITE_MINUTES)
}

/// The measurements as a table on the run's page, also when a limit failed.
fn summary() -> Step<Run> {
    Step::new("summarize the measurements")
        .run(
            "if [ -f .cache/chat-scale/summary.md ]; then\n  \
             cat .cache/chat-scale/summary.md >> \"$GITHUB_STEP_SUMMARY\"\n\
             fi",
        )
        .working_directory(xtask_paths::repo_dir!("apps/web"))
        .if_condition(always())
}
