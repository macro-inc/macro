use super::*;

fn step_names() -> Vec<String> {
    let job = serde_json::to_value(export()).unwrap();
    job["steps"]
        .as_array()
        .unwrap()
        .iter()
        .map(|step| step["name"].as_str().unwrap().to_owned())
        .collect()
}

/// The collector reads data a run produced, so it must run before any credential.
#[test]
fn events_are_collected_before_any_credential_exists() {
    let names = step_names();
    let position = |name: &str| names.iter().position(|step| step == name).unwrap();
    assert!(position("Collect push, job and step events") < position("Assume CI telemetry role"));
    assert!(position("Read ingestion credential") < position("Send push, job and step events"));
}

/// The event steps are best effort, and must run when the trace preflight refuses a run.
#[test]
fn event_steps_cannot_fail_the_exporter_and_survive_preflight() {
    let job = serde_json::to_value(export()).unwrap();
    for step in job["steps"].as_array().unwrap() {
        let name = step["name"].as_str().unwrap();
        if name.ends_with("push, job and step events") {
            assert_eq!(step["continue-on-error"], true, "{name}");
            assert_eq!(step["if"], "always()", "{name}");
        }
    }
}

#[test]
fn only_the_send_step_sees_the_ingestion_headers() {
    let job = serde_json::to_value(export()).unwrap();
    for step in job["steps"].as_array().unwrap() {
        if step["name"] == "Collect push, job and step events" {
            assert!(step["env"]["OTLP_HEADERS"].is_null());
        }
    }
}

fn workflow_names(pull_request_only: bool) -> Vec<String> {
    let workflows = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../../.github/workflows");
    let mut names = Vec::new();
    for entry in std::fs::read_dir(workflows).unwrap() {
        let path = entry.unwrap().path();
        if !matches!(
            path.extension().and_then(|extension| extension.to_str()),
            Some("yml" | "yaml")
        ) {
            continue;
        }
        let workflow: serde_yaml::Value =
            serde_yaml::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        let triggers = &workflow["on"];
        let on_pull_request = ["pull_request", "pull_request_target"].iter().any(|name| {
            triggers.get(*name).is_some()
                || triggers.as_str() == Some(name)
                || triggers
                    .as_sequence()
                    .is_some_and(|list| list.iter().any(|item| item.as_str() == Some(name)))
        });
        if on_pull_request || !pull_request_only {
            names.push(workflow["name"].as_str().unwrap_or_default().to_owned());
        }
    }
    names
}

/// A push counts as finished once every check has, and only a listed workflow's
/// completion triggers the exporter, so an unlisted one that finishes last loses the
/// push. A new PR workflow must choose: observed, or bookkeeping that seldom finishes last.
#[test]
fn every_pull_request_workflow_is_observed_or_bookkeeping() {
    let missing: Vec<_> = workflow_names(true)
        .into_iter()
        .filter(|name| {
            !OBSERVED_WORKFLOWS.contains(&name.as_str())
                && !UNOBSERVED_PR_WORKFLOWS.contains(&name.as_str())
        })
        .collect();
    assert!(
        missing.is_empty(),
        "add to OBSERVED_WORKFLOWS or UNOBSERVED_PR_WORKFLOWS: {missing:?}"
    );
}

#[test]
fn unobserved_workflows_exist_and_are_not_observed() {
    let names = workflow_names(false);
    for name in UNOBSERVED_PR_WORKFLOWS {
        assert!(
            names.iter().any(|known| known == name),
            "no workflow named {name}"
        );
        assert!(
            !OBSERVED_WORKFLOWS.contains(name),
            "{name} is in both lists"
        );
    }
}

/// A run whose jobs were all skipped must not start the exporter: it has nothing to
/// export, and about half of all completions are such runs.
#[test]
fn skipped_runs_start_no_export() {
    let job = serde_json::to_value(export()).unwrap();
    assert_eq!(
        job["if"],
        "github.event.workflow_run.conclusion != 'skipped'"
    );
}

/// Only the preflight lists the run's jobs, after it checked the budget, and the
/// collector reads the same file instead of listing them again.
#[test]
fn preflight_and_collector_share_the_job_listing() {
    let job = serde_json::to_value(export()).unwrap();
    let steps = job["steps"].as_array().unwrap();
    let files: Vec<_> = steps
        .iter()
        .filter_map(|step| step["env"]["CI_TELEMETRY_JOBS"].as_str())
        .collect();
    assert_eq!(files, [JOBS_FILE, JOBS_FILE]);
    assert_eq!(steps[0]["id"], "preflight");
    let preflight = include_str!("../scripts/ci_telemetry_preflight.js");
    let budget = preflight.find("rateLimit.get()").unwrap();
    let listing = preflight.find("listJobsForWorkflowRunAttempt").unwrap();
    assert!(
        budget < listing,
        "check the budget before the first counted call"
    );
}

/// Actions would expand this in the embedded source before the shell ever saw it.
#[test]
fn embedded_scripts_contain_no_actions_expressions() {
    for script in [
        include_str!("../scripts/ci_telemetry_collect.ts"),
        include_str!("../scripts/ci_telemetry_send.ts"),
    ] {
        assert!(!script.contains("${{"));
    }
}

#[test]
fn collector_scenarios() {
    let output = std::process::Command::new("node")
        .args(["--test", "ci_telemetry.test.ts"])
        .current_dir(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/src/workflows/scripts"
        ))
        .output()
        .expect("run CI telemetry scenarios with Node");
    assert!(
        output.status.success(),
        "CI telemetry scenarios failed:\n{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}
