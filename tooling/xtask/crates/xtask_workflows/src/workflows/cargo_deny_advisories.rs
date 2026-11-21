//! `cargo deny advisories` — daily on `main`, `cargo deny check advisories`
//! against the live RustSec database. Generated into
//! `cargo_deny_advisories.yml`.
//!
//! A PR fails only on advisories against packages it adds to `Cargo.lock`
//! ([`super::cargo_deny`]), so one published against a package already on
//! `main` fails this run instead. A failed run posts to the Macro Alerts
//! channel: GitHub emails a scheduled run's failure only to whoever last
//! edited its cron line, and only if they opted in.

use gh_workflow::expr::typed::failure;
use gh_workflow::{
    Event, Job, Level, Permissions, Run, Schedule, Step, Workflow, WorkflowDispatch, ZizmorRule,
};

use crate::workflows::{cargo_deny, runners, steps};

/// Build the workflow.
pub fn cargo_deny_advisories() -> Workflow {
    Workflow::new("cargo deny advisories")
        .on(Event::default()
            .add_schedule(Schedule::new("23 6 * * *"))
            .workflow_dispatch(WorkflowDispatch::default()))
        .add_job("advisories", advisories_job())
}

fn advisories_job() -> Job {
    Job::default()
        .name("cargo deny check advisories")
        .timeout_minutes(15u32)
        .runs_on(runners::Runner::Small.to_string())
        .permissions(Permissions::default().contents(Level::Read))
        .add_step(cargo_deny::checkout().step().zizmor_ignore(
            ZizmorRule::Artipacked,
            "cargo deny fetches git dependencies",
        ))
        .add_step(steps::setup_rust_light())
        .add_step(cargo_deny::install_cargo_deny())
        .add_step(cargo_deny::deny("advisories"))
        .add_step(alert())
}

/// Post a failed run to the Macro Alerts channel, as
/// `alert-native-build-failures.yml` does for native builds.
fn alert() -> Step<Run> {
    steps::post_to_macro_alerts(
        "Post the failure to Macro Alerts",
        indoc::indoc! {r#"
            run_url="$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"
            message="🚨 The daily cargo deny advisories run failed on $GITHUB_REF_NAME. If the log shows a RustSec advisory against a package in Cargo.lock, update the crate, or ignore the advisory in deny.toml with a reason. $run_url"
        "#},
    )
    .if_condition(failure())
}
