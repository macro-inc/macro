use super::*;

fn rendered() -> serde_yaml::Value {
    let yaml = crate::workflows::render_patched(pr_ci, patch).expect("PR CI should render");
    serde_yaml::from_str(&yaml).expect("PR CI should parse")
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

/// Without a limit GitHub lets a stalled job run for six hours, holding the gate.
#[test]
fn every_job_the_gate_waits_for_has_a_timeout() {
    let workflows = concat!(env!("CARGO_MANIFEST_DIR"), "/../../../../.github/workflows");
    let called = CALLS.iter().map(|call| {
        let path = format!("{workflows}/{}", call.file);
        let workflow: serde_yaml::Value =
            serde_yaml::from_str(&std::fs::read_to_string(&path).expect("called workflow exists"))
                .expect("called workflow parses");
        (call.file, workflow)
    });

    for (file, workflow) in std::iter::once(("pr-ci.yml", rendered())).chain(called) {
        let jobs = workflow["jobs"].as_mapping().expect("jobs");
        for (id, job) in jobs {
            if job.get("uses").is_some() {
                continue;
            }
            assert!(
                job.get("timeout-minutes").is_some(),
                "{file} job {} has no timeout-minutes",
                id.as_str().unwrap_or_default()
            );
        }
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
