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
