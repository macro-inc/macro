use super::*;

fn rendered() -> serde_yaml::Value {
    let yaml = crate::workflows::render_patched(pr_ci, patch).expect("PR CI should render");
    serde_yaml::from_str(&yaml).expect("PR CI should parse")
}

/// The committed YAML of a workflow PR CI calls.
fn called(call: &Call) -> serde_yaml::Value {
    let path = format!(
        "{}/../../../../.github/workflows/{}",
        env!("CARGO_MANIFEST_DIR"),
        call.file
    );
    serde_yaml::from_str(&std::fs::read_to_string(&path).expect("called workflow exists"))
        .expect("called workflow parses")
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
    for call in CALLS {
        let workflow = called(call);
        let triggers = &workflow["on"];

        assert!(
            triggers.get("workflow_call").is_some(),
            "{} has no workflow_call trigger",
            call.file
        );
    }
}

/// Without a limit GitHub lets a stalled job run for six hours, holding the gate.
/// A job limit at or just above a step limit inside it would cut that step short.
#[test]
fn every_job_the_gate_waits_for_has_a_timeout() {
    let workflows = std::iter::once(("pr-ci.yml", rendered()))
        .chain(CALLS.iter().map(|call| (call.file, called(call))));

    for (file, workflow) in workflows {
        let jobs = workflow["jobs"].as_mapping().expect("jobs");
        for (id, job) in jobs {
            if job.get("uses").is_some() {
                continue;
            }
            let id = id.as_str().unwrap_or_default();
            let limit = job
                .get("timeout-minutes")
                .and_then(serde_yaml::Value::as_u64)
                .unwrap_or_else(|| panic!("{file} job {id} has no numeric timeout-minutes"));
            let longest_step = job["steps"]
                .as_sequence()
                .into_iter()
                .flatten()
                .filter_map(|step| step.get("timeout-minutes")?.as_u64())
                .max()
                .unwrap_or_default();
            assert!(
                limit >= longest_step + 5,
                "{file} job {id} allows {limit} minutes, too little for its {longest_step}-minute step"
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
