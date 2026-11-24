//! `Connectors end-to-end` — the `connectors_e2e` suite: Macro's connectors
//! on dev, driven through the public API and an agent session as two test
//! accounts, against the real Pipedream, Macro Connect, a native MCP server
//! and the GitHub account link. Generated into `connectors_e2e.yml`.
//!
//! It runs nightly against what is deployed to dev, and by hand
//! (`workflow_dispatch`, of any branch: the suite's own code comes from the
//! branch, the services it drives are dev's). Never on pull requests: it acts
//! as real accounts on a shared environment. Without the accounts' API keys
//! every scenario skips. Its last job tells the channel
//! [`CONNECTORS_ALERTS`] names when the nightly runs turn red, and when they
//! pass again ([`email_e2e_alert`]).

use gh_workflow::expr::typed::{JobHandle, always};
use gh_workflow::{
    Event, Job, Level, Permissions, Run, Schedule, Step, Workflow, WorkflowDispatch,
};

use crate::workflows::email_e2e_alert::Channel;
use crate::workflows::{
    code_check_cloud_storage, email_e2e, email_e2e_alert, runners,
    steps::{self, FluentBuilder},
    vars,
};

/// 05:00 UTC, after the channels suite's nightly run.
const NIGHTLY: &str = "0 5 * * *";

/// The job that runs the suite.
const SUITE_JOB: JobHandle<()> = JobHandle::new("suite", ());

/// Where the suite's run leaves the report the alert job reads.
const RESULTS: xtask_paths::RuntimePath<'static> =
    xtask_paths::runtime_path!("target/connectors-e2e-results");

/// The artifact the suite uploads its report as.
const REPORT_ARTIFACT: &str = "connectors-e2e-report";

/// The channel a failure is reported to: the one Tod reads.
const CONNECTORS_ALERTS: Channel = Channel {
    job: "Tell the connectors channel",
    post: "post to the connectors channel",
    label: "The connectors channel",
    webhook: vars::CONNECTORS_E2E_ALERT_WEBHOOK_URL,
    token: vars::CONNECTORS_E2E_ALERT_BOT_TOKEN,
};

/// Build the workflow.
pub fn connectors_e2e() -> Workflow {
    Workflow::new("Connectors end-to-end")
        .permissions(Permissions {
            contents: Some(Level::Read),
            ..Default::default()
        })
        .on(Event::default()
            .add_schedule(Schedule::new(NIGHTLY))
            .workflow_dispatch(WorkflowDispatch::default()))
        .concurrency(email_e2e::concurrency("connectors-e2e"))
        .map(vars::with_global_env)
        .add_job(SUITE_JOB, suite())
        .add_job(
            email_e2e_alert::JOB,
            email_e2e_alert::job_to(&CONNECTORS_ALERTS, &[&SUITE_JOB], REPORT_ARTIFACT),
        )
}

/// Build the suite and run it against dev.
fn suite() -> Job {
    Job::default()
        .name("Connectors end-to-end")
        .timeout_minutes(90u32)
        .runs_on(runners::Runner::Large.with_cache_tag(vars::CI_CACHE_TAG))
        .map(code_check_cloud_storage::with_test_compile_env)
        .add_env(("SQLX_OFFLINE", "true"))
        .add_env(("SCCACHE_IDLE_TIMEOUT", "0"))
        .add_env(("CONNECTORS_E2E_RESULTS", RESULTS.as_str()))
        .add_step(steps::checkout(false, false))
        .add_step(steps::mount_cache_volume())
        .add_step(steps::reuse_cargo_target())
        .add_step(steps::setup_nix_with_seed())
        .add_step(steps::setup_dev_shell().timeout_minutes(vars::DEV_SHELL_TIMEOUT_MINUTES))
        .add_step(steps::configure_namespace_sccache(vars::CI_SCCACHE_NAME))
        .add_step(steps::start_sccache_server())
        .add_step(run_suite())
        .add_step(
            steps::upload_artifact_action(REPORT_ARTIFACT, RESULTS)
                .if_no_files_found("ignore")
                .retention_days(7)
                .step()
                .if_condition(always()),
        )
        .add_step(steps::show_sccache_stats())
        .add_step(steps::teardown_nix())
        .add_step(steps::seal_cargo_target())
}

/// Run the scenarios as the two test accounts, and write the report the
/// alert job reads.
fn run_suite() -> Step<Run> {
    Step::new("run the connectors end-to-end scenarios")
        .run(include_str!("scripts/connectors_e2e.sh"))
        .add_env((
            "CONNECTORS_E2E_FLAGGED_API_KEY",
            vars::CONNECTORS_E2E_FLAGGED_API_KEY,
        ))
        .add_env((
            "CONNECTORS_E2E_UNFLAGGED_API_KEY",
            vars::CONNECTORS_E2E_UNFLAGGED_API_KEY,
        ))
        .add_env((
            "CONNECTORS_E2E_CONNECT_APP",
            vars::CONNECTORS_E2E_CONNECT_APP,
        ))
        .add_env((
            "CONNECTORS_E2E_PIPEDREAM_APP",
            vars::CONNECTORS_E2E_PIPEDREAM_APP,
        ))
        .add_env((
            "CONNECTORS_E2E_GITHUB_LINKED",
            vars::CONNECTORS_E2E_GITHUB_LINKED,
        ))
        .add_env((
            "CONNECTORS_E2E_MCP_SERVER_URL",
            vars::CONNECTORS_E2E_MCP_SERVER_URL,
        ))
        .add_env((
            "CONNECTORS_E2E_NOTION_PAGE",
            vars::CONNECTORS_E2E_NOTION_PAGE,
        ))
}
