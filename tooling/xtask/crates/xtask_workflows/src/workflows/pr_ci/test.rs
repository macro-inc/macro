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

fn rendered_plain(build: fn() -> gh_workflow::Workflow) -> serde_yaml::Value {
    let yaml = crate::workflows::render_gh_workflow(build)().expect("workflow should render");
    serde_yaml::from_str(&yaml).expect("workflow should parse")
}

/// `PR CI` runs only on PRs into main. The label checks must still answer a
/// request on any other base, or `CI gate` keeps whatever it said.
#[test]
fn the_label_checks_answer_on_every_base() {
    for build in [
        crate::workflows::ci_gate_label::ci_gate_label,
        crate::workflows::ci_gate_fork::ci_gate_fork,
    ] {
        let workflow = rendered_plain(build);
        let trigger = &workflow["on"]["pull_request_target"];

        assert!(
            trigger.is_mapping(),
            "{:?} has no label trigger",
            workflow["name"]
        );
        assert!(
            trigger.get("branches").is_none(),
            "{:?} must see labels on every base",
            workflow["name"]
        );
    }
}

/// `workflow_run` names the workflow it follows; a rename of `PR CI` would
/// silently stop closing requests its runs leave open.
#[test]
fn run_end_follows_pr_ci() {
    let run_end = rendered_plain(crate::workflows::ci_gate_run_end::ci_gate_run_end);

    assert_eq!(
        run_end["on"]["workflow_run"]["workflows"][0],
        rendered()["name"]
    );
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
