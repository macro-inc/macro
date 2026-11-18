//! `Alert native build failures` — posts a native build that failed in a
//! completed release workflow to the Macro Alerts channel. A `workflow_run`
//! job reports the failure without exposing the Macro bot token to the build
//! runners or checking out code from a pull request.
//!
//! It reads the repository variable [`vars::MACRO_BUILD_ALERT_WEBHOOK_URL`]
//! and the secret [`vars::MACRO_BUILD_ALERT_BOT_TOKEN`], a channel-scoped
//! webhook credential for the Alerts channel.

use gh_workflow::expr::typed::{Bool, Expr, Json, Str, from_json, github};
use gh_workflow::{
    Event, Job, Level, Permissions, Run, Step, Workflow, WorkflowRun, WorkflowRunType,
};

use crate::workflows::vars;

/// The workflows whose native build jobs this alerts on; the script names
/// each one's build jobs.
const WATCHED_WORKFLOWS: &[&str] = &[
    "Build Desktop on Tag",
    "iOS Preview",
    "Release Android App Bundle",
];

/// Build the workflow.
pub fn alert_native_build_failures() -> Workflow {
    Workflow::new("Alert native build failures")
        .on(Event::default().workflow_run(
            WorkflowRun::default()
                .workflows(
                    WATCHED_WORKFLOWS
                        .iter()
                        .map(|name| (*name).to_owned())
                        .collect::<Vec<_>>(),
                )
                .add_type(WorkflowRunType::Completed),
        ))
        .permissions(Permissions::default().actions(Level::Read))
        .add_job("alert", alert())
}

/// The watched run failed or timed out.
fn failed() -> Expr<Bool> {
    from_json::<Json>(Expr::from(r#"["failure", "timed_out"]"#))
        .contains(github().event::<Str>("workflow_run.conclusion"))
}

fn alert() -> Job {
    Job::default()
        .cond(failed())
        .runs_on("ubuntu-24.04")
        .timeout_minutes(10u32)
        .add_step(notify())
}

fn notify() -> Step<Run> {
    Step::new("Notify Macro Alerts about failed native builds")
        .run(include_str!("scripts/alert_native_build_failures.sh"))
        .shell("bash")
        .add_env(("GH_TOKEN", github().token()))
        .add_env(("SOURCE_RUN_ID", github().event::<Str>("workflow_run.id")))
        .add_env((
            "SOURCE_WORKFLOW",
            github().event::<Str>("workflow_run.name"),
        ))
        .add_env((
            "SOURCE_REF",
            github().event::<Str>("workflow_run.head_branch"),
        ))
        .add_env(("MACRO_WEBHOOK_URL", vars::MACRO_BUILD_ALERT_WEBHOOK_URL))
        .add_env(("MACRO_BOT_TOKEN", vars::MACRO_BUILD_ALERT_BOT_TOKEN))
}
