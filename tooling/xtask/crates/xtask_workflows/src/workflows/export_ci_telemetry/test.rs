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

/// A push counts as finished once every check has, and only a listed workflow's
/// completion triggers the exporter, so an unlisted one that finishes last loses the push.
#[test]
fn every_pull_request_workflow_is_observed() {
    let workflows = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../../.github/workflows");
    let mut missing = Vec::new();
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
        let name = workflow["name"].as_str().unwrap_or_default();
        if on_pull_request && !OBSERVED_WORKFLOWS.contains(&name) {
            missing.push(name.to_owned());
        }
    }
    assert!(missing.is_empty(), "add to OBSERVED_WORKFLOWS: {missing:?}");
}

#[test]
fn collector_scenarios() {
    let output = std::process::Command::new("python3")
        .args(["-B", "-m", "unittest", "test_ci_telemetry"])
        .current_dir(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/src/workflows/scripts"
        ))
        .output()
        .expect("run CI telemetry scenarios with Python");
    assert!(
        output.status.success(),
        "CI telemetry scenarios failed:\n{}",
        String::from_utf8_lossy(&output.stderr)
    );
}
