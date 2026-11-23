//! `Alert native build failures` — posts a native build that failed in a
//! completed release workflow to the Macro Alerts channel. A `workflow_run`
//! job reports the failure without exposing the Macro bot token to the build
//! runners or checking out code from a pull request.
//!
//! For `Build Desktop on Tag` every failed job posts, the publish jobs
//! included, and so does a tag's run that was cancelled without a newer run
//! for the tag replacing it: a job that runs out of time cancels the run.
//! [`super::desktop_release_watch`] covers the runs that never end, or never
//! start.
//!
//! It reads the repository variable [`vars::MACRO_BUILD_ALERT_WEBHOOK_URL`]
//! and the secret [`vars::MACRO_BUILD_ALERT_BOT_TOKEN`], a channel-scoped
//! webhook credential for the Alerts channel.

use gh_workflow::expr::typed::{Bool, Expr, Json, Str, from_json, github};
use gh_workflow::{
    Event, Job, Level, Permissions, Run, Step, Workflow, WorkflowRun, WorkflowRunType,
};

use crate::workflows::vars;

/// The desktop workflow, whose every job this alerts on.
const DESKTOP_WORKFLOW: &str = "Build Desktop on Tag";

/// The workflows whose native build jobs this alerts on; the script names
/// each one's build jobs.
const WATCHED_WORKFLOWS: &[&str] = &[
    DESKTOP_WORKFLOW,
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

/// The watched run failed or timed out, or a tag's desktop run was cancelled.
fn failed() -> Expr<Bool> {
    let conclusion = || github().event::<Str>("workflow_run.conclusion");
    let desktop_tag = github()
        .event::<Str>("workflow_run.name")
        .eq(DESKTOP_WORKFLOW)
        .and(github().event::<Str>("workflow_run.event").eq("push"));
    from_json::<Json>(Expr::from(r#"["failure", "timed_out"]"#))
        .contains(conclusion())
        .or(conclusion().eq("cancelled").and(desktop_tag))
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
            "SOURCE_WORKFLOW_ID",
            github().event::<Str>("workflow_run.workflow_id"),
        ))
        .add_env((
            "SOURCE_CONCLUSION",
            github().event::<Str>("workflow_run.conclusion"),
        ))
        .add_env((
            "SOURCE_REF",
            github().event::<Str>("workflow_run.head_branch"),
        ))
        .add_env(("MACRO_WEBHOOK_URL", vars::MACRO_BUILD_ALERT_WEBHOOK_URL))
        .add_env(("MACRO_BOT_TOKEN", vars::MACRO_BUILD_ALERT_BOT_TOKEN))
}
