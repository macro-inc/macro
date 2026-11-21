use super::*;
use crate::workflows::{
    channels_e2e, email_e2e, email_e2e_browser, email_e2e_full_stack, render_gh_workflow,
};

/// A workflow's file name and its builder.
type Build = (&'static str, fn() -> gh_workflow::Workflow);

/// The workflows with the job, rendered as they are committed.
fn workflows() -> Vec<(&'static str, serde_yaml::Value)> {
    let builds: [Build; 3] = [
        ("email_e2e", email_e2e::email_e2e),
        ("email_e2e_browser", email_e2e_browser::email_e2e_browser),
        (
            "email_e2e_full_stack",
            email_e2e_full_stack::email_e2e_full_stack,
        ),
    ];
    let parse = |yaml: String| serde_yaml::from_str(&yaml).expect("the workflow parses");
    builds
        .into_iter()
        .map(|(name, build)| {
            let yaml = render_gh_workflow(build)().expect("the workflow renders");
            (name, parse(yaml))
        })
        .chain([(
            "channels_e2e",
            parse(render_gh_workflow(channels_e2e::channels_e2e)().expect("the workflow renders")),
        )])
        .collect()
}

/// A step of the alert job, by name.
fn step<'a>(workflow: &'a serde_yaml::Value, name: &str) -> &'a serde_yaml::Value {
    workflow["jobs"][JOB.id()]["steps"]
        .as_sequence()
        .expect("steps")
        .iter()
        .find(|step| step["name"].as_str() == Some(name))
        .unwrap_or_else(|| panic!("no step {name}"))
}

/// A job it does not wait for could fail after it decided the run passed.
#[test]
fn the_alert_waits_for_every_other_job() {
    for (name, workflow) in workflows() {
        let jobs = workflow["jobs"].as_mapping().expect("jobs");
        let mut others: Vec<&str> = jobs
            .keys()
            .filter_map(serde_yaml::Value::as_str)
            .filter(|id| *id != JOB.id())
            .collect();
        let mut needs: Vec<&str> = workflow["jobs"][JOB.id()]["needs"]
            .as_sequence()
            .unwrap_or_else(|| panic!("{name} has no {JOB} job that needs the others"))
            .iter()
            .filter_map(serde_yaml::Value::as_str)
            .collect();
        others.sort_unstable();
        needs.sort_unstable();

        assert_eq!(needs, others, "{name}");
    }
}

/// A run by hand, or of another branch, posts nothing.
#[test]
fn only_pushes_to_main_and_the_sweep_post() {
    for (name, workflow) in workflows() {
        assert_eq!(
            workflow["jobs"][JOB.id()]["if"].as_str(),
            Some(posts().condition().0.as_str()),
            "{name}"
        );
        assert_eq!(
            step(&workflow, POST)["if"].as_str(),
            Some(posts_when_decided().condition().0.as_str()),
            "{name}"
        );
    }
}

/// Two alert jobs of a stream at once would both read what the channel
/// showed before either posted.
#[test]
fn a_streams_alert_jobs_run_one_at_a_time() {
    for (name, workflow) in workflows() {
        let concurrency = &workflow["jobs"][JOB.id()]["concurrency"];
        assert_eq!(
            concurrency["group"].as_str(),
            Some(one_at_a_time().as_str()),
            "{name}"
        );
        assert_eq!(
            concurrency["cancel-in-progress"].as_bool(),
            Some(false),
            "{name}"
        );
    }
}

/// A workflow's runs queue for each event and branch, not for each commit:
/// a push that waits is replaced by the next, whose alert job posts in its
/// place. The run in progress is never cancelled, since a cancelled run's
/// alert job never runs, and a run by hand or a re-run stays out of the
/// queue, where a re-run would replace the push waiting with an older commit.
#[test]
fn a_workflows_runs_queue_without_cancelling_the_one_running() {
    let mut groups = Vec::new();
    for (name, workflow) in workflows() {
        let concurrency = &workflow["concurrency"];
        assert_eq!(
            concurrency["cancel-in-progress"].as_bool(),
            Some(false),
            "{name}"
        );
        let group = concurrency["group"].as_str().expect("a group");
        assert!(
            !group.contains("github.sha"),
            "{name} queues each commit apart: {group}"
        );
        assert!(
            group.contains(
                "(github.event_name == 'workflow_dispatch' || github.run_attempt != '1') && github.run_id"
            ),
            "{name} queues a run by hand or a re-run behind the pushes: {group}"
        );
        groups.push(group.to_owned());
    }
    groups.sort_unstable();
    groups.dedup();
    assert_eq!(groups.len(), 4, "two workflows share a queue: {groups:?}");
}

/// The script reads the job and its steps by the names the workflow gives
/// them, and the steps that record what the channel shows come last.
#[test]
fn the_script_reads_the_names_the_workflow_gives() {
    for (name, workflow) in workflows() {
        let job = &workflow["jobs"][JOB.id()];
        let env = &step(&workflow, "decide what to post")["env"];
        assert_eq!(
            job["name"].as_str(),
            env["EMAIL_E2E_ALERT_JOB"].as_str(),
            "{name}"
        );
        let steps: Vec<&str> = job["steps"]
            .as_sequence()
            .expect("steps")
            .iter()
            .filter_map(|step| step["name"].as_str())
            .collect();
        assert_eq!(
            steps[steps.len() - 3..],
            [
                env["EMAIL_E2E_ALERT_POST_STEP"].as_str().expect("post"),
                env["EMAIL_E2E_ALERT_FAILING_STEP"]
                    .as_str()
                    .expect("failing"),
                env["EMAIL_E2E_ALERT_PASSING_STEP"]
                    .as_str()
                    .expect("passing"),
            ],
            "{name}"
        );
        for (record, shows) in [(SHOWS_FAILING, "failing"), (SHOWS_PASSING, "passing")] {
            assert_eq!(
                step(&workflow, record)["if"].as_str(),
                Some(records_when(shows).condition().0.as_str()),
                "{name}"
            );
        }
    }
}

/// The job reads the report the workflow's coverage job uploads.
#[test]
fn the_alert_downloads_the_report_the_workflow_uploads() {
    for (name, workflow) in workflows() {
        let steps = workflow["jobs"][JOB.id()]["steps"]
            .as_sequence()
            .expect("steps");
        let report = steps[0]["with"]["name"].as_str().expect("an artifact name");
        let uploaded = workflow["jobs"]
            .as_mapping()
            .expect("jobs")
            .values()
            .flat_map(|job| job["steps"].as_sequence().into_iter().flatten())
            .any(|step| step["with"]["name"].as_str() == Some(report));

        assert!(uploaded, "{name} uploads no {report} artifact");
    }
}

/// Actions would expand this in the embedded source before the shell ever saw it.
#[test]
fn the_alert_script_contains_no_actions_expressions() {
    assert!(!include_str!("../scripts/email_e2e_alert.ts").contains("${{"));
}

#[test]
fn alert_script_scenarios() {
    let output = std::process::Command::new("node")
        .args(["--test", "email_e2e_alert.test.ts"])
        .current_dir(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/src/workflows/scripts"
        ))
        .env_remove("BASH_ENV")
        .output()
        .expect("run the alert script's tests with Node");

    assert!(
        output.status.success(),
        "alert script tests failed:\n{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}
