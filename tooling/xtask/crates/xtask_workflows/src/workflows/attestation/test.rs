use std::collections::BTreeSet;

use super::*;

/// The action a `uses` step names, without its version.
fn action(step: &serde_yaml::Value) -> Option<&str> {
    let uses = step["uses"].as_str()?;
    Some(uses.split_once('@').map_or(uses, |(name, _)| name))
}

fn steps_of(job: &serde_yaml::Value) -> impl Iterator<Item = &serde_yaml::Value> {
    job["steps"].as_sequence().into_iter().flatten()
}

fn run_steps(job: &serde_yaml::Value) -> Vec<&str> {
    steps_of(job)
        .filter(|step| step.get("run").is_some())
        .map(|step| step["name"].as_str().expect("a run step has a name"))
        .collect()
}

/// `cargo x attest` runs the listed steps and skips the runner's. A step in
/// neither list is one nobody decided about: skipped, it would let a machine
/// attest a job without running part of it.
#[test]
fn every_step_of_an_attested_job_is_the_check_or_runner_upkeep() {
    for check in CHECKS {
        let call = call_of(check).expect("the check's call exists");
        let root = rendered(call.file, true).expect("workflow renders");
        let definition = job(&root, check.job, call.file).expect("job exists");
        let ran = run_steps(definition);

        for step in check.steps {
            assert!(ran.contains(step), "{} has no step `{step}`", check.id());
        }
        for step in &ran {
            assert!(
                check.steps.contains(step) || RUNNER_STEPS.contains(step),
                "{}: is `{step}` part of the check or runner upkeep?",
                check.id()
            );
        }
    }
}

/// An action `cargo x attest` skips must only prepare a runner; one it can't
/// classify could be the check itself. It runs the repository's own composite
/// actions and emulates the path filter.
#[test]
fn every_action_of_an_attested_job_is_one_cargo_x_attest_handles() {
    for check in CHECKS {
        let call = call_of(check).expect("the check's call exists");
        let root = rendered(call.file, true).expect("workflow renders");
        let mut jobs = vec![check.job];
        if is_selected(&root["jobs"][check.job]) {
            jobs.push(SELECTOR_JOB);
        }

        for id in jobs {
            for step in steps_of(&root["jobs"][id]) {
                let Some(action) = action(step) else { continue };
                assert!(
                    RUNNER_ACTIONS.contains(&action)
                        || action == FILTER_ACTION
                        || action.starts_with("./.github/actions/"),
                    "{} job {id} uses {action}, which cargo x attest can't stand in for",
                    call.file
                );
            }
        }
    }
}

/// A machine has no repository secrets or service containers, and a job
/// skipped by attestation skips every job that needs it.
#[test]
fn an_attested_job_needs_nothing_a_machine_lacks() {
    for check in CHECKS {
        let call = call_of(check).expect("the check's call exists");
        let root = rendered(call.file, true).expect("workflow renders");
        let definition = &root["jobs"][check.job];

        // The runner's own steps may: `cargo x attest` never runs them.
        let mut read_by_the_check = vec![definition["env"].clone(), definition["if"].clone()];
        read_by_the_check.extend(
            steps_of(definition)
                .filter(|step| {
                    step["name"]
                        .as_str()
                        .is_some_and(|name| check.steps.contains(&name))
                })
                .cloned(),
        );
        let text = serde_yaml::to_string(&read_by_the_check).expect("steps serialize");
        assert!(!text.contains("secrets."), "{} reads a secret", check.id());
        assert!(
            definition.get("services").is_none(),
            "{} needs service containers",
            check.id()
        );

        let needs: Vec<&str> = definition["needs"]
            .as_sequence()
            .into_iter()
            .flatten()
            .filter_map(serde_yaml::Value::as_str)
            .collect();
        assert!(
            needs.iter().all(|need| *need == SELECTOR_JOB),
            "{} needs {needs:?}; cargo x attest runs only path-check first",
            check.id()
        );

        for (id, other) in root["jobs"].as_mapping().expect("jobs") {
            let dependents = other["needs"].as_sequence().into_iter().flatten();
            assert!(
                dependents
                    .filter_map(serde_yaml::Value::as_str)
                    .all(|need| need != check.job),
                "{} job {id:?} needs {}, so skipping one skips both",
                call.file,
                check.job
            );
        }
    }
}

#[test]
fn every_attested_job_skips_on_its_own_entry() {
    let checks = described().expect("checks render");
    let ids: BTreeSet<&str> = checks.iter().map(|check| check.id.as_str()).collect();
    assert_eq!(ids.len(), checks.len(), "two checks share an id");

    for check in &checks {
        let root = rendered(check.workflow, true).expect("workflow renders");
        let condition = root["jobs"][check.job]["if"]
            .as_str()
            .expect("an attested job has a condition");
        let clause = skip_clause(&check.id, check.selected);

        assert!(
            condition.ends_with(&clause),
            "{}: `{condition}` does not end with `{clause}`",
            check.id
        );
        if let Some(own) = &check.condition {
            assert_eq!(condition, format!("({own}) && {clause}"));
        }
    }
}

/// `path-check` hashes the outputs a job reads; one it can't see would hash as
/// empty on both sides and accept an attestation for any selection.
#[test]
fn path_check_hashes_every_output_a_selected_job_reads() {
    for check in described().expect("checks render") {
        if !check.selected {
            assert!(check.inputs.is_empty(), "{} reads path-check", check.id);
            continue;
        }

        let root = rendered(check.workflow, true).expect("workflow renders");
        let accept = steps_of(&root["jobs"][SELECTOR_JOB])
            .find(|step| step["name"].as_str() == Some(ACCEPT_STEP))
            .expect("path-check accepts attested checks");
        let listed: serde_json::Value = serde_json::from_str(
            accept["env"]["CHECK_INPUTS"]
                .as_str()
                .expect("CHECK_INPUTS is set"),
        )
        .expect("CHECK_INPUTS is JSON");

        assert!(
            !check.inputs.is_empty(),
            "{} waits for path-check without reading it",
            check.id
        );
        assert_eq!(listed[&check.id], serde_json::json!(check.inputs));
        for input in &check.inputs {
            assert!(
                accept["env"][format!("OUTPUT_{input}")].as_str().is_some(),
                "path-check does not pass `{input}` to the accept step"
            );
        }
    }
}

/// A workflow that takes no `attested` input would fail to be called with one,
/// and one that is not handed it would never skip.
#[test]
fn pr_ci_hands_attestations_to_exactly_the_workflows_with_checks() {
    let yaml = crate::workflows::render_patched(pr_ci::pr_ci, pr_ci::patch).expect("PR CI renders");
    let workflow: serde_yaml::Value = serde_yaml::from_str(&yaml).expect("PR CI parses");

    for call in pr_ci::CALLS {
        let called = rendered(call.file, true).expect("workflow renders");
        let takes = called["on"]["workflow_call"]["inputs"]
            .get("attested")
            .is_some();
        let handed = workflow["jobs"][call.id]["with"].get("attested").is_some();

        assert_eq!(takes, calls_attested(call), "{}", call.file);
        assert_eq!(handed, calls_attested(call), "{}", call.id);
    }
}

#[test]
fn the_accept_script_contains_no_actions_expressions() {
    assert!(!include_str!("../scripts/accept_attested_checks.ts").contains("${{"));
}

#[test]
fn accept_script_scenarios() {
    let output = std::process::Command::new("node")
        .args(["--test", "accept_attested_checks.test.ts"])
        .current_dir(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/src/workflows/scripts"
        ))
        .output()
        .expect("run the accept scenarios with Node");
    assert!(
        output.status.success(),
        "accept scenarios failed:\n{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}
