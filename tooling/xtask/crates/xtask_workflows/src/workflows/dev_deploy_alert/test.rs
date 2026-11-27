use super::*;
use crate::workflows::{WORKFLOWS, render_gh_workflow};

fn parse(build: fn() -> Workflow) -> serde_yaml::Value {
    let yaml = render_gh_workflow(build)().expect("the workflow renders");
    serde_yaml::from_str(&yaml).expect("the workflow parses")
}

fn alert() -> serde_yaml::Value {
    parse(dev_deploy_alert)
}

/// A step of the alert job, by name.
fn step<'a>(workflow: &'a serde_yaml::Value, name: &str) -> &'a serde_yaml::Value {
    workflow["jobs"]["alert"]["steps"]
        .as_sequence()
        .expect("steps")
        .iter()
        .find(|step| step["name"].as_str() == Some(name))
        .unwrap_or_else(|| panic!("no step {name}"))
}

fn decide_env<'a>(workflow: &'a serde_yaml::Value, name: &str) -> &'a str {
    step(workflow, "decide what to post")["env"][name]
        .as_str()
        .unwrap_or_else(|| panic!("no {name}"))
}

/// Actions would expand this in the embedded source before the shell ever saw it.
#[test]
fn the_script_contains_no_actions_expressions() {
    assert!(!include_str!("../scripts/dev_deploy_alert.ts").contains("${{"));
}

#[test]
fn the_script_decides_when_dev_is_failing_and_what_to_post() {
    let output = std::process::Command::new("node")
        .args(["--test", "dev_deploy_alert.test.ts"])
        .current_dir(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/src/workflows/scripts"
        ))
        .env_remove("BASH_ENV")
        .output()
        .expect("run the Dev deploy alert's tests with Node");

    assert!(
        output.status.success(),
        "Dev deploy alert tests failed:\n{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

/// `workflow_run` matches the watched workflow by its name, so a rename of
/// the deploy workflow would silently stop the alerts on its runs.
#[test]
fn it_watches_the_dev_deploy_by_name_and_reads_its_runs_by_file() {
    let workflow = alert();
    let deploy = parse(deploy_on_push::deploy_on_push);
    assert_eq!(
        workflow["on"]["workflow_run"]["workflows"],
        serde_yaml::Value::from(vec![deploy["name"].clone()])
    );
    assert_eq!(
        workflow["on"]["workflow_run"]["branches"],
        deploy["on"]["push"]["branches"]
    );

    let file = decide_env(&workflow, "DEV_DEPLOY_WORKFLOW");
    assert!(
        WORKFLOWS
            .iter()
            .any(|each| each.slug == "deploy_on_push" && each.file_name == file),
        "{file} is not the deploy workflow's file"
    );
    let cancel = parse(cancel_stuck_cloud_storage_deploys::cancel_stuck_cloud_storage_deploys);
    assert_eq!(
        cancel["jobs"]["cancel-stuck"]["env"]["WORKFLOW_FILE"].as_str(),
        Some(file)
    );
}

/// The message says when a cancelled deploy was past the age the schedule
/// cancels at.
#[test]
fn it_reads_the_age_the_schedule_cancels_deploys_at() {
    let cancel = parse(cancel_stuck_cloud_storage_deploys::cancel_stuck_cloud_storage_deploys);
    assert_eq!(
        cancel["on"]["workflow_dispatch"]["inputs"]["max-age-minutes"]["default"].as_str(),
        Some(decide_env(&alert(), "DEV_DEPLOY_CANCEL_STUCK_MINUTES"))
    );
}

/// The script finds the job and its steps by the names it is given.
#[test]
fn the_names_the_script_reads_are_the_jobs_and_steps() {
    let workflow = alert();
    assert_eq!(
        workflow["jobs"]["alert"]["name"].as_str(),
        Some(decide_env(&workflow, "DEV_DEPLOY_ALERT_JOB"))
    );
    assert_eq!(
        step(&workflow, MACRO_ALERTS.post)["if"].as_str(),
        Some(posts_when_decided().condition().0.as_str())
    );
    for (env, shows) in [
        ("DEV_DEPLOY_ALERT_FAILING_STEP", "failing"),
        ("DEV_DEPLOY_ALERT_DEPLOYING_STEP", "deploying"),
    ] {
        assert_eq!(
            step(&workflow, decide_env(&workflow, env))["if"].as_str(),
            Some(records_when(shows).condition().0.as_str()),
            "{env}"
        );
    }
}

/// Two runs at once would both read what the channel showed before either
/// posted; cancelling the one running could lose its record after its post.
#[test]
fn its_runs_go_one_at_a_time() {
    let concurrency = &alert()["concurrency"];
    assert_eq!(concurrency["group"].as_str(), Some("dev-deploy-alert"));
    assert_eq!(concurrency["cancel-in-progress"].as_bool(), Some(false));
}

/// It runs after every deploy run, between them on a schedule, and by hand,
/// posting only on `main`.
#[test]
fn it_runs_after_deploys_and_on_a_schedule() {
    let workflow = alert();
    assert_eq!(
        workflow["on"]["workflow_run"]["types"],
        serde_yaml::Value::from(vec!["completed"])
    );
    assert_eq!(
        workflow["on"]["schedule"][0]["cron"].as_str(),
        Some(SCHEDULE)
    );
    assert_eq!(
        workflow["jobs"]["alert"]["if"].as_str(),
        Some(posts().condition().0.as_str())
    );
}

/// A `workflow_run` job that checks out nothing runs no code from the deploy,
/// and reads the runs with a token that can do nothing else.
#[test]
fn it_reads_the_api_and_checks_out_nothing() {
    let workflow = alert();
    let mut permissions = serde_yaml::Mapping::new();
    permissions.insert("actions".into(), "read".into());
    permissions.insert("contents".into(), "read".into());
    assert_eq!(
        workflow["permissions"],
        serde_yaml::Value::Mapping(permissions)
    );
    assert!(
        workflow["jobs"]["alert"]["steps"]
            .as_sequence()
            .expect("steps")
            .iter()
            .all(|step| step["uses"].is_null())
    );
}
