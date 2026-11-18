//! The last job of the three email end-to-end workflows (`email_e2e.rs`,
//! `email_e2e_browser.rs`, `email_e2e_full_stack.rs`): after every other
//! job of a push to `main` or of the daily sweep, it tells the Macro Alerts
//! channel when the workflow turns red, and when it turns green again. Not on
//! a run by hand. `scripts/email_e2e_alert.ts` decides whether a run posts,
//! and what it says; the job's last step records what the channel then shows,
//! which the next run's job reads.

use gh_workflow::{Concurrency, Expression, Job, Level, Permissions, Run, Step, Use};

use crate::workflows::{runners, steps};

#[cfg(test)]
mod test;

/// The job's id in each workflow.
pub(crate) const JOB: &str = "email-e2e-alert";

/// The job's name, by which the script finds it in a run's jobs.
const NAME: &str = "Tell Macro Alerts";

/// The runs that can post: a push to `main` and the sweep, unless cancelled.
const POSTS: &str = "!cancelled() && github.ref == 'refs/heads/main' && \
                     (github.event_name == 'push' || github.event_name == 'schedule')";

/// One alert job of a stream at a time, each reading what the one before it
/// recorded. The one running is never cancelled; one waiting is replaced by
/// the next to queue, whose run ended later.
const ONE_AT_A_TIME: &str =
    "email-e2e-alert-${{ github.workflow }}-${{ github.event_name }}-${{ github.ref }}";

/// Where the job puts the run's coverage report.
const REPORTS: &str = "${{ runner.temp }}/email-e2e-reports";

/// Where the script leaves the message.
const MESSAGE: &str = "${{ runner.temp }}/email-e2e-alert.md";

/// The step that decides, by its id.
const DECIDE: &str = "decide";

/// The step that posts, by its name.
const POST: &str = "post to Macro Alerts";

/// The steps that record what the channel shows once the job is done, by name.
const SHOWS_FAILING: &str = "the channel shows it failing";
const SHOWS_PASSING: &str = "the channel shows it passing";

/// The job, after `needs`: every other job of the workflow. `report` is the
/// artifact the workflow's coverage job uploads its report as.
pub(crate) fn job(needs: &[&str], report: &str) -> Job {
    Job::default()
        .name(NAME)
        .needs(
            needs
                .iter()
                .map(|need| need.to_string())
                .collect::<Vec<_>>(),
        )
        .cond(Expression::new(POSTS))
        .concurrency(Concurrency::new(Expression::new(ONE_AT_A_TIME)).cancel_in_progress(false))
        .timeout_minutes(10u32)
        .runs_on(runners::Runner::Small.to_string())
        .permissions(Permissions {
            actions: Some(Level::Read),
            contents: Some(Level::Read),
            ..Default::default()
        })
        .add_step(download(report))
        .add_step(decide())
        .add_step(post())
        .add_step(record(SHOWS_FAILING, "failing"))
        .add_step(record(SHOWS_PASSING, "passing"))
}

/// The run's coverage report, which names what failed. A run that failed
/// before the report was written has none, and the message says so.
fn download(report: &str) -> Step<Use> {
    Step::new("download the coverage report")
        .uses(
            "actions",
            "download-artifact",
            "634f93cb2916e3fdff6788551b99b062d0335ce0",
        ) // v5
        .add_with(("name", report))
        .add_with(("path", REPORTS))
        .continue_on_error(true)
}

fn decide() -> Step<Run> {
    Step::new("decide what to post")
        .run(steps::node_script(include_str!(
            "scripts/email_e2e_alert.ts"
        )))
        .id(DECIDE)
        .shell("bash")
        .add_env(("GH_TOKEN", "${{ github.token }}"))
        .add_env(("EMAIL_E2E_REPORTS", REPORTS))
        .add_env(("EMAIL_E2E_ALERT_MESSAGE", MESSAGE))
        .add_env(("EMAIL_E2E_ALERT_JOB", NAME))
        .add_env(("EMAIL_E2E_ALERT_POST_STEP", POST))
        .add_env(("EMAIL_E2E_ALERT_FAILING_STEP", SHOWS_FAILING))
        .add_env(("EMAIL_E2E_ALERT_PASSING_STEP", SHOWS_PASSING))
}

/// When the post step runs.
fn posts_when_decided() -> String {
    format!("steps.{DECIDE}.outputs.post == 'true'")
}

fn post() -> Step<Run> {
    steps::post_to_macro_alerts(POST, r#"message=$(cat "$EMAIL_E2E_ALERT_MESSAGE")"#)
        .add_env(("EMAIL_E2E_ALERT_MESSAGE", MESSAGE))
        .if_condition(Expression::new(posts_when_decided()))
}

/// When the step recording that the channel shows the stream `shows` runs.
fn records_when(shows: &str) -> String {
    format!("steps.{DECIDE}.outputs.shows == '{shows}'")
}

/// A step the next run's job reads through the jobs API: it runs only once
/// the post succeeded or none was needed, so a failed post records nothing.
fn record(name: &str, shows: &str) -> Step<Run> {
    Step::new(name)
        .run(format!(
            "echo 'Macro Alerts now shows this workflow {shows} on this branch.'"
        ))
        .if_condition(Expression::new(records_when(shows)))
}
