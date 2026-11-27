//! `Dev Deploy Alert` — tells the Macro Alerts channel when Dev stops
//! deploying, and when it deploys again. Generated into
//! `dev-deploy-alert.yml`.
//!
//! Dev deploys from [`super::deploy_on_push`], whose runs wait for each other;
//! a push that waits is replaced by the next one, and ends cancelled before any
//! of its jobs started. GitHub tells nobody when a run fails, and nothing when
//! a run waits for a runner for hours until
//! [`super::cancel_stuck_cloud_storage_deploys`] cancels it, so this job checks
//! Dev itself, when a deploy run ends (`workflow_run`) and every quarter of an
//! hour. `scripts/dev_deploy_alert.ts` decides whether Dev is failing (a run
//! that ended badly past the replaced ones, a job waiting an hour for a
//! runner, a commit undeployed for three hours) and whether to post; the job's
//! last step records what the channel then shows, which the next run reads.
//!
//! It reads the deploy runs through the API and checks out nothing, so the
//! `workflow_run` trigger runs no code from the deploy. It runs on GitHub's own
//! runner, not the deploys' Namespace and in-VPC ones, so it still runs when
//! those give the deploys none.

use gh_workflow::expr::typed::{Bool, Expr, Flag, StepHandle, StepOutput, Str, github, runner};
use gh_workflow::{
    Concurrency, Event, Job, Level, Permissions, Run, Schedule, Step, Workflow, WorkflowDispatch,
    WorkflowRun, WorkflowRunType,
};

use crate::workflows::email_e2e_alert::MACRO_ALERTS;
use crate::workflows::{cancel_stuck_cloud_storage_deploys, deploy_on_push, runners, steps};

#[cfg(test)]
mod test;

/// The steps that record what the channel shows once the job is done, by name.
const SHOWS_FAILING: &str = "Macro Alerts shows Dev failing";
const SHOWS_DEPLOYING: &str = "Macro Alerts shows Dev deploying";

/// When the job runs between deploys: a quarter past, and so on, off the hour
/// GitHub's scheduler is busiest at.
const SCHEDULE: &str = "7,22,37,52 * * * *";

/// Build the workflow.
pub fn dev_deploy_alert() -> Workflow {
    Workflow::new("Dev Deploy Alert")
        .on(Event::default()
            .workflow_run(
                WorkflowRun::default()
                    .add_workflow(deploy_on_push::NAME)
                    .add_type(WorkflowRunType::Completed)
                    .add_branch("main"),
            )
            .add_schedule(Schedule::new(SCHEDULE))
            .workflow_dispatch(WorkflowDispatch::default()))
        // The deploy runs and their jobs; `main`'s newest commit and the
        // commits since Dev's.
        .permissions(
            Permissions::default()
                .actions(Level::Read)
                .contents(Level::Read),
        )
        // Each run reads what the one before it recorded. The one running is
        // never cancelled; one waiting is replaced by the next to queue, which
        // reads Dev as it is then.
        .concurrency(Concurrency::new("dev-deploy-alert").cancel_in_progress(false))
        .add_job("alert", job())
}

/// The runs that can post: those on `main`, not a run by hand on a branch.
fn posts() -> Expr<Bool> {
    github().git_ref().eq("refs/heads/main")
}

fn job() -> Job {
    Job::default()
        .name(MACRO_ALERTS.job)
        .cond(posts())
        .timeout_minutes(10u32)
        .runs_on(runners::GITHUB_LINUX)
        .add_step(decide())
        .add_step(post())
        .add_step(record(SHOWS_FAILING, "failing"))
        .add_step(record(SHOWS_DEPLOYING, "deploying"))
}

/// Where the script leaves the message.
fn message() -> String {
    format!("{}/dev-deploy-alert.md", runner().temp())
}

struct DecideOutputs {
    /// Whether there is a message to post.
    post: StepOutput<Flag>,
    /// What the channel shows once the job is done: `failing` or `deploying`.
    shows: StepOutput<Str>,
}

/// The step that decides.
const DECIDE: StepHandle<DecideOutputs> = StepHandle::new(
    "decide",
    DecideOutputs {
        post: StepOutput::new("decide", "post"),
        shows: StepOutput::new("decide", "shows"),
    },
);

fn decide() -> Step<Run> {
    Step::new("decide what to post")
        .run(steps::node_script(include_str!(
            "scripts/dev_deploy_alert.ts"
        )))
        .id(DECIDE.id())
        .shell("bash")
        .add_env(("GH_TOKEN", github().token()))
        .add_env(("DEV_DEPLOY_WORKFLOW", deploy_on_push::FILE))
        .add_env((
            "DEV_DEPLOY_CANCEL_STUCK_MINUTES",
            cancel_stuck_cloud_storage_deploys::MAX_AGE_MINUTES,
        ))
        .add_env(("DEV_DEPLOY_ALERT_MESSAGE", message()))
        .add_env(("DEV_DEPLOY_ALERT_JOB", MACRO_ALERTS.job))
        .add_env(("DEV_DEPLOY_ALERT_FAILING_STEP", SHOWS_FAILING))
        .add_env(("DEV_DEPLOY_ALERT_DEPLOYING_STEP", SHOWS_DEPLOYING))
}

/// When the post step runs.
fn posts_when_decided() -> Expr<Bool> {
    DECIDE.outputs.post.read().is_set()
}

fn post() -> Step<Run> {
    steps::post_to_macro_alerts(
        MACRO_ALERTS.post,
        r#"message=$(cat "$DEV_DEPLOY_ALERT_MESSAGE")"#,
    )
    .add_env(("DEV_DEPLOY_ALERT_MESSAGE", message()))
    .if_condition(posts_when_decided())
}

/// When the step recording that the channel shows Dev `shows` runs.
fn records_when(shows: &str) -> Expr<Bool> {
    DECIDE.outputs.shows.read().eq(shows)
}

/// A step the next run's job reads through the jobs API: it runs only once
/// the post succeeded or none was needed, so a failed post records nothing.
fn record(name: &str, shows: &str) -> Step<Run> {
    Step::new(name)
        .run(format!("echo 'Macro Alerts now shows Dev {shows}.'"))
        .if_condition(records_when(shows))
}
