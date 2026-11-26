//! The last job of the three email end-to-end workflows (`email_e2e.rs`,
//! `email_e2e_browser.rs`, `email_e2e_full_stack.rs`), of the channels
//! end-to-end workflow (`channels_e2e.rs`) and of the connectors end-to-end
//! workflow (`connectors_e2e.rs`): after every other job of a push to `main`
//! or of the daily sweep, it tells a Macro channel (Macro Alerts, or the
//! [`Channel`] the workflow names) when the workflow turns red, and when it
//! turns green again. Not on a run by hand. `scripts/email_e2e_alert.ts` decides whether a run posts,
//! and what it says; the job's last step records what the channel then shows,
//! which the next run's job reads.

use gh_workflow::expr::typed::{
    Bool, Expr, Flag, JobHandle, Secret, StepHandle, StepOutput, Str, Var, cancelled, github,
    runner,
};
use gh_workflow::{Concurrency, Job, Level, Permissions, Run, Step, Use};

use crate::workflows::actions::ActionsDownloadArtifact;
use crate::workflows::{runners, steps, vars};

#[cfg(test)]
mod test;

/// The job, in each workflow.
pub(crate) const JOB: JobHandle<()> = JobHandle::new("email-e2e-alert", ());

/// The Macro channel a workflow's alert job tells, and how.
pub(crate) struct Channel {
    /// The job's name, by which the script finds it in a run's jobs.
    pub job: &'static str,
    /// The step that posts, by its name.
    pub post: &'static str,
    /// The channel's name, for messages.
    pub label: &'static str,
    /// The channel's webhook, a repo variable.
    pub webhook: Var,
    /// The bot token the webhook takes.
    pub token: Secret,
}

/// The Macro Alerts channel, which the email and channels suites tell.
pub(crate) const MACRO_ALERTS: Channel = Channel {
    job: "Tell Macro Alerts",
    post: "post to Macro Alerts",
    label: "Macro Alerts",
    webhook: vars::MACRO_BUILD_ALERT_WEBHOOK_URL,
    token: vars::MACRO_BUILD_ALERT_BOT_TOKEN,
};

/// The runs that can post: a push to `main` and the sweep, unless cancelled.
fn posts() -> Expr<Bool> {
    (!cancelled())
        .and(github().git_ref().eq("refs/heads/main"))
        .and(
            github()
                .event_name()
                .eq("push")
                .or(github().event_name().eq("schedule")),
        )
}

/// One alert job of a stream at a time, each reading what the one before it
/// recorded. The one running is never cancelled; one waiting is replaced by
/// the next to queue, whose run ended later.
fn one_at_a_time() -> String {
    format!(
        "email-e2e-alert-{}-{}-{}",
        github().workflow(),
        github().event_name(),
        github().git_ref()
    )
}

/// Where the job puts the run's coverage report.
fn reports() -> String {
    format!("{}/email-e2e-reports", runner().temp())
}

/// Where the script leaves the message.
fn message() -> String {
    format!("{}/email-e2e-alert.md", runner().temp())
}

struct DecideOutputs {
    /// Whether there is a message to post.
    post: StepOutput<Flag>,
    /// What the channel shows once the job is done: `failing` or `passing`.
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

/// The steps that record what the channel shows once the job is done, by name.
const SHOWS_FAILING: &str = "the channel shows it failing";
const SHOWS_PASSING: &str = "the channel shows it passing";

/// The job telling [`MACRO_ALERTS`], after `needs`: every other job of the
/// workflow. `report` is the artifact the workflow's coverage job uploads its
/// report as.
pub(crate) fn job(needs: &[&JobHandle<()>], report: &str) -> Job {
    job_to(&MACRO_ALERTS, needs, report)
}

/// [`job`], telling `channel`.
pub(crate) fn job_to(channel: &Channel, needs: &[&JobHandle<()>], report: &str) -> Job {
    Job::default()
        .name(channel.job)
        .needs(
            needs
                .iter()
                .map(|need| need.to_string())
                .collect::<Vec<_>>(),
        )
        .cond(posts())
        .concurrency(Concurrency::new(one_at_a_time()).cancel_in_progress(false))
        .timeout_minutes(10u32)
        .runs_on(runners::Runner::Small.to_string())
        .permissions(Permissions {
            actions: Some(Level::Read),
            contents: Some(Level::Read),
            ..Default::default()
        })
        .add_step(download(report))
        .add_step(decide(channel))
        .add_step(post(channel))
        .add_step(record(channel, SHOWS_FAILING, "failing"))
        .add_step(record(channel, SHOWS_PASSING, "passing"))
}

/// The run's coverage report, which names what failed. A run that failed
/// before the report was written has none, and the message says so.
fn download(report: &str) -> Step<Use> {
    ActionsDownloadArtifact::new("download the coverage report")
        .name(report)
        .path(reports())
        .step()
        .continue_on_error(true)
}

fn decide(channel: &Channel) -> Step<Run> {
    Step::new("decide what to post")
        .run(steps::node_script(include_str!(
            "scripts/email_e2e_alert.ts"
        )))
        .id(DECIDE.id())
        .shell("bash")
        .add_env(("GH_TOKEN", github().token()))
        .add_env(("EMAIL_E2E_REPORTS", reports()))
        .add_env(("EMAIL_E2E_ALERT_MESSAGE", message()))
        .add_env(("EMAIL_E2E_ALERT_JOB", channel.job))
        .add_env(("EMAIL_E2E_ALERT_POST_STEP", channel.post))
        .add_env(("EMAIL_E2E_ALERT_FAILING_STEP", SHOWS_FAILING))
        .add_env(("EMAIL_E2E_ALERT_PASSING_STEP", SHOWS_PASSING))
}

/// When the post step runs.
fn posts_when_decided() -> Expr<Bool> {
    DECIDE.outputs.post.read().is_set()
}

fn post(channel: &Channel) -> Step<Run> {
    steps::post_to_macro_channel(
        channel.post,
        r#"message=$(cat "$EMAIL_E2E_ALERT_MESSAGE")"#,
        channel.label,
        channel.webhook,
        channel.token,
    )
    .add_env(("EMAIL_E2E_ALERT_MESSAGE", message()))
    .if_condition(posts_when_decided())
}

/// When the step recording that the channel shows the stream `shows` runs.
fn records_when(shows: &str) -> Expr<Bool> {
    DECIDE.outputs.shows.read().eq(shows)
}

/// A step the next run's job reads through the jobs API: it runs only once
/// the post succeeded or none was needed, so a failed post records nothing.
fn record(channel: &Channel, name: &str, shows: &str) -> Step<Run> {
    Step::new(name)
        .run(format!(
            "echo '{} now shows this workflow {shows} on this branch.'",
            channel.label
        ))
        .if_condition(records_when(shows))
}
