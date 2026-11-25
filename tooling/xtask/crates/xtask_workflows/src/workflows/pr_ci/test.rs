use super::*;

fn rendered() -> serde_yaml::Value {
    let yaml = crate::workflows::render_gh_workflow(pr_ci)().expect("PR CI should render");
    serde_yaml::from_str(&yaml).expect("PR CI should parse")
}

/// The path of the workflow a call runs, as its `uses` names it.
fn uses(call: &Call) -> String {
    (call.workflow)().uses
}

/// The committed YAML of a workflow PR CI calls.
fn called(call: &Call) -> serde_yaml::Value {
    let path = format!("{}/../../../../{}", env!("CARGO_MANIFEST_DIR"), uses(call));
    serde_yaml::from_str(&std::fs::read_to_string(&path).expect("called workflow exists"))
        .expect("called workflow parses")
}

/// A called workflow the gate doesn't wait for could fail after the gate passed,
/// so only a call marked outside the gate may be left out.
#[test]
fn the_gate_waits_for_start_and_every_gating_call() {
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
        CALLS
            .iter()
            .filter(|call| call.gating)
            .map(|call| call.id)
            .collect::<Vec<_>>()
    );
    let outside: Vec<&str> = CALLS
        .iter()
        .filter(|call| !call.gating)
        .map(|call| call.id)
        .collect();
    assert_eq!(outside, ["desktop-windows"]);
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
            uses(call)
        );
    }
}

/// Without a limit GitHub lets a stalled job run for six hours, holding the gate.
/// A job limit at or just above a step limit inside it would cut that step short.
#[test]
fn every_job_the_gate_waits_for_has_a_timeout() {
    let workflows = std::iter::once(("pr-ci.yml".to_string(), rendered()))
        .chain(CALLS.iter().map(|call| (uses(call), called(call))));

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

/// The gate reads each call's result, which fails or cancels when any of its
/// jobs does, so the called workflows need no roll-up job of their own. A job
/// that continues on error, or an always-run job, could hide a failed job from
/// that result, and a roll-up costs every run a runner and a queue wait.
#[test]
fn every_called_job_reaches_the_gate() {
    for call in CALLS {
        let workflow = called(call);
        let jobs = workflow["jobs"].as_mapping().expect("jobs");
        for (id, job) in jobs {
            let id = id.as_str().unwrap_or_default();
            assert!(
                job.get("continue-on-error").is_none(),
                "{} job {id} continues on error, so the gate can't see it fail",
                uses(call)
            );
            let condition = job.get("if").and_then(serde_yaml::Value::as_str);
            assert!(
                !condition.is_some_and(|condition| condition.contains("always()")),
                "{} job {id} is a roll-up; the gate reads the call's result instead",
                uses(call)
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

/// What a PR check reads from history is commits, trees and a few blobs, which
/// git fetches on demand; fetching every blob of the full history took about
/// 40 s per job.
#[test]
fn full_history_checkouts_fetch_no_blobs_up_front() {
    for call in CALLS {
        let workflow = called(call);
        for (id, job) in workflow["jobs"].as_mapping().expect("jobs") {
            let id = id.as_str().unwrap_or_default();
            for step in job["steps"].as_sequence().into_iter().flatten() {
                let with = &step["with"];
                let full = with["fetch-depth"].as_str() == Some("0")
                    || with["fetch-depth"].as_u64() == Some(0);
                assert!(
                    !full || with["filter"].as_str() == Some("blob:none"),
                    "{} job {id} fetches every blob of the full history",
                    uses(call)
                );
            }
        }
    }
}

/// A blobless full-history checkout is prepared right after it: Nix can't open
/// a repository marked as a partial clone, and `biome --changed` must not need
/// old blobs.
#[test]
fn blobless_history_is_prepared() {
    for call in CALLS {
        let workflow = called(call);
        for (id, job) in workflow["jobs"].as_mapping().expect("jobs") {
            let id = id.as_str().unwrap_or_default();
            let steps: Vec<_> = job["steps"].as_sequence().into_iter().flatten().collect();
            for (index, step) in steps.iter().enumerate() {
                let with = &step["with"];
                let full = with["fetch-depth"].as_str() == Some("0")
                    || with["fetch-depth"].as_u64() == Some(0);
                if !full || with["filter"].as_str().is_none() {
                    continue;
                }
                let run = steps
                    .get(index + 1)
                    .and_then(|next| next["run"].as_str())
                    .unwrap_or_default();
                assert!(
                    run.contains("git config --unset extensions.partialclone")
                        && run.contains("git config diff.renames false"),
                    "{} job {id} doesn't prepare its blobless checkout",
                    uses(call)
                );
            }
        }
    }
}
