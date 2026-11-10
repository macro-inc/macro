use super::*;

fn rendered() -> serde_yaml::Value {
    let yaml = crate::workflows::render_patched(pr_ci, patch).expect("PR CI should render");
    serde_yaml::from_str(&yaml).expect("PR CI should parse")
}

#[test]
fn stacked_pull_requests_can_request_and_receive_a_gate() {
    for (yaml, event) in [
        (pr_ci().to_string(), "pull_request"),
        (
            crate::workflows::ci_gate_reminder::ci_gate_reminder().to_string(),
            "pull_request",
        ),
        (
            crate::workflows::ci_gate_fork::ci_gate_fork().to_string(),
            "pull_request_target",
        ),
    ] {
        let yaml = yaml.expect("gate should render");
        let workflow: serde_yaml::Value = serde_yaml::from_str(&yaml).expect("gate should parse");
        let trigger = &workflow["on"][event];
        assert!(trigger.is_mapping(), "missing {event} trigger");
        assert!(trigger.get("branches").is_none(), "stacked bases must run");
        assert!(trigger.get("branches-ignore").is_none());
    }
}

/// A called workflow the gate doesn't wait for could fail after the gate passed.
#[test]
fn the_gate_waits_for_start_and_every_call() {
    let workflow = rendered();
    let needs: Vec<&str> = workflow["jobs"]["gate"]["needs"]
        .as_sequence()
        .expect("gate needs")
        .iter()
        .filter_map(serde_yaml::Value::as_str)
        .collect();

    assert_eq!(needs[0], "start");
    assert_eq!(
        &needs[1..],
        CALLS.iter().map(|call| call.id).collect::<Vec<_>>()
    );
}

/// GitHub refuses to call a workflow without a `workflow_call` trigger.
#[test]
fn every_called_workflow_can_be_called() {
    let workflows = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../../.github/workflows");
    for call in CALLS {
        let path = format!("{workflows}/{}", call.file);
        let workflow: serde_yaml::Value =
            serde_yaml::from_str(&std::fs::read_to_string(&path).expect("called workflow exists"))
                .expect("called workflow parses");
        let triggers = &workflow["on"];

        assert!(
            triggers.get("workflow_call").is_some(),
            "{} has no workflow_call trigger",
            call.file
        );
    }
}

/// Runs for other labels must neither share a group with a request (and
/// cancel it) nor reach a called workflow.
#[test]
fn only_the_run_label_starts_anything() {
    let workflow = rendered();

    assert_eq!(
        workflow["jobs"]["start"]["if"].as_str(),
        Some("github.event.label.name == 'run-ci'")
    );
    for call in CALLS {
        let needs = &workflow["jobs"][call.id]["needs"];
        assert_eq!(
            needs[0].as_str(),
            Some("start"),
            "{} must wait for start",
            call.id
        );
    }
    let group = workflow["concurrency"]["group"].as_str().expect("group");
    assert!(group.contains("github.event.label.name == 'run-ci' && 'requested' || github.run_id"));
}

/// Actions would expand this in the embedded source before the shell ever saw it.
#[test]
fn the_gate_script_contains_no_actions_expressions() {
    assert!(!include_str!("../scripts/ci_gate.ts").contains("${{"));
}

#[test]
fn gate_script_scenarios() {
    let output = std::process::Command::new("node")
        .args(["--test", "ci_gate.test.ts"])
        .current_dir(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/src/workflows/scripts"
        ))
        .output()
        .expect("run CI gate scenarios with Node");
    assert!(
        output.status.success(),
        "CI gate scenarios failed:\n{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

/// A gate result was for the PR's old base; retargeting a stacked PR to
/// `main` must not keep it.
#[test]
fn a_base_change_resets_the_gate() {
    let yaml = crate::workflows::ci_gate_reminder::ci_gate_reminder()
        .to_string()
        .expect("reminder should render");
    let workflow: serde_yaml::Value = serde_yaml::from_str(&yaml).expect("reminder should parse");

    let types: Vec<&str> = workflow["on"]["pull_request"]["types"]
        .as_sequence()
        .expect("reminder types")
        .iter()
        .filter_map(serde_yaml::Value::as_str)
        .collect();
    assert!(types.contains(&"edited"));

    let remind = &workflow["jobs"]["remind"];
    let condition = remind["if"].as_str().expect("remind condition");
    assert!(condition.contains("github.event.changes.base != null"));
    assert_eq!(
        remind["steps"][0]["env"]["BASE_CHANGED"].as_str(),
        Some("${{ github.event.action == 'edited' }}")
    );
}
