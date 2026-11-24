//! `Desktop Release Watch` — hourly cron that posts to the Macro Alerts
//! channel when a production release's desktop installers never arrive.
//!
//! [`super::alert_native_build_failures`] posts when a job of
//! [`super::build_desktop_on_tag`] fails. A run that never starts, waits for
//! a runner for hours, or ends without attaching every installer posts
//! nothing there, so this checks the releases themselves:
//! `scripts/desktop_release_watch.ts` looks for the DMG, the AppImage and
//! their signed update archives on each production release a few hours after
//! it was published, and names the tag's `Build Desktop on Tag` run in the
//! message.

use gh_workflow::expr::typed::{Flag, StepHandle, StepOutput, github, runner};
use gh_workflow::{
    Concurrency, Event, Job, Level, Permissions, Run, Schedule, Step, Workflow, WorkflowDispatch,
};

use crate::workflows::{runners, steps};

#[cfg(test)]
mod test;

/// Build the workflow.
pub fn desktop_release_watch() -> Workflow {
    Workflow::new("Desktop Release Watch")
        .on(Event::default()
            .add_schedule(Schedule::new("41 * * * *"))
            .workflow_dispatch(WorkflowDispatch::default()))
        .permissions(
            Permissions::default()
                .actions(Level::Read)
                .contents(Level::Read),
        )
        .add_job("watch", watch_job())
}

fn watch_job() -> Job {
    Job::default()
        .name("Alert when a release's desktop installers are missing")
        .runs_on(runners::Runner::Small.to_string())
        // Each run reads where the one before it left off.
        .concurrency(Concurrency::new("desktop-release-watch").cancel_in_progress(false))
        .timeout_minutes(10u32)
        .add_step(check())
        .add_step(post())
}

struct CheckOutputs {
    /// Whether there is a message to post.
    post: StepOutput<Flag>,
}

/// The [`check`] step.
const CHECK: StepHandle<CheckOutputs> = StepHandle::new(
    "check",
    CheckOutputs {
        post: StepOutput::new("check", "post"),
    },
);

/// Where the script leaves the message.
fn message() -> String {
    format!("{}/desktop-release-watch.md", runner().temp())
}

fn check() -> Step<Run> {
    Step::new("Check recent releases for their desktop installers")
        .run(steps::node_script(include_str!(
            "scripts/desktop_release_watch.ts"
        )))
        .id(CHECK.id())
        .shell("bash")
        .add_env(("GH_TOKEN", github().token()))
        .add_env(("DESKTOP_RELEASE_WATCH_MESSAGE", message()))
}

fn post() -> Step<Run> {
    steps::post_to_macro_alerts(
        "Post missing installers to Macro Alerts",
        r#"message=$(cat "$DESKTOP_RELEASE_WATCH_MESSAGE")"#,
    )
    .add_env(("DESKTOP_RELEASE_WATCH_MESSAGE", message()))
    .if_condition(CHECK.outputs.post.read().is_set())
}
