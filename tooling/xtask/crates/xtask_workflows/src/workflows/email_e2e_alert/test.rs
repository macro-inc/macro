use super::*;
use crate::workflows::{email_e2e, email_e2e_browser, email_e2e_full_stack};

/// A workflow's file name and its builder.
type Build = (&'static str, fn() -> gh_workflow::Workflow);

/// The three workflows, rendered as they are committed.
fn workflows() -> Vec<(&'static str, serde_yaml::Value)> {
    let builds: [Build; 3] = [
        ("email_e2e", email_e2e::email_e2e),
        ("email_e2e_browser", email_e2e_browser::email_e2e_browser),
        (
            "email_e2e_full_stack",
            email_e2e_full_stack::email_e2e_full_stack,
        ),
    ];
    builds
        .into_iter()
        .map(|(name, build)| {
            let yaml = email_e2e::render(build).expect("the workflow renders");
            (
                name,
                serde_yaml::from_str(&yaml).expect("the workflow parses"),
            )
        })
        .collect()
}

/// A job it does not wait for could fail after it decided the run passed.
#[test]
fn the_alert_waits_for_every_other_job() {
    for (name, workflow) in workflows() {
        let jobs = workflow["jobs"].as_mapping().expect("jobs");
        let mut others: Vec<&str> = jobs
            .keys()
            .filter_map(serde_yaml::Value::as_str)
            .filter(|id| *id != JOB)
            .collect();
        let mut needs: Vec<&str> = workflow["jobs"][JOB]["needs"]
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
        let job = &workflow["jobs"][JOB];
        assert_eq!(job["if"].as_str(), Some(POSTS), "{name}");
        let post = job["steps"]
            .as_sequence()
            .and_then(|steps| steps.last())
            .expect("steps");
        assert_eq!(
            post["if"].as_str(),
            Some(posts_when_decided().as_str()),
            "{name}"
        );
    }
}

/// The job reads the report the workflow's coverage job uploads.
#[test]
fn the_alert_downloads_the_report_the_workflow_uploads() {
    for (name, workflow) in workflows() {
        let steps = workflow["jobs"][JOB]["steps"].as_sequence().expect("steps");
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
