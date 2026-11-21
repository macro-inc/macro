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

/// A job in neither list is one nobody decided about, and a job in a list
/// that no longer exists is a decision about nothing.
#[test]
fn every_job_pr_ci_runs_is_attestable_or_says_why_not() {
    let mut exist = BTreeSet::new();
    for call in pr_ci::CALLS {
        let root = rendered(call).expect("workflow renders");
        for (id, _) in root["jobs"].as_mapping().expect("jobs") {
            exist.insert(format!("{}/{}", call.id, id.as_str().expect("a job id")));
        }
    }

    let attestable: BTreeSet<String> = CHECKS.iter().map(Check::id).collect();
    let not: BTreeSet<String> = NOT_ATTESTABLE
        .iter()
        .map(|job| format!("{}/{}", job.call, job.job))
        .collect();

    assert_eq!(attestable.len(), CHECKS.len(), "a check is listed twice");
    assert_eq!(not.len(), NOT_ATTESTABLE.len(), "a job is listed twice");
    assert_eq!(
        attestable.intersection(&not).collect::<Vec<_>>(),
        Vec::<&String>::new(),
        "a job is in both lists"
    );
    let decided: BTreeSet<String> = attestable.union(&not).cloned().collect();
    assert_eq!(decided, exist);
    assert!(NOT_ATTESTABLE.iter().all(|job| !job.why.is_empty()));
}

/// A machine runs the listed steps and skips the runner's. A step in neither
/// list is one nobody decided about: skipped, it would let a machine attest a
/// job without running part of it.
#[test]
fn every_step_of_an_attested_job_is_the_check_or_runner_upkeep() {
    for check in CHECKS {
        let call = call_of(check.call).expect("the check's call exists");
        let root = rendered(call).expect("workflow renders");
        let definition = job(&root, check.job, call.id).expect("job exists");
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

/// An action a machine skips must only prepare a runner. One that changes
/// what the check reads, or that is the check, has no script to run instead.
#[test]
fn every_action_of_an_attested_job_only_prepares_a_runner() {
    for check in CHECKS {
        let call = call_of(check.call).expect("the check's call exists");
        let root = rendered(call).expect("workflow renders");

        for step in steps_of(&root["jobs"][check.job]) {
            let Some(action) = action(step) else { continue };
            assert!(
                RUNNER_ACTIONS.contains(&action),
                "{} uses {action}; is it runner setup, or is the job not attestable?",
                check.id()
            );
        }
    }
}

/// A machine has no repository secrets or service containers, and a job
/// skipped by attestation skips every job that needs it.
#[test]
fn an_attested_job_needs_nothing_a_machine_lacks() {
    for check in CHECKS {
        let call = call_of(check.call).expect("the check's call exists");
        let root = rendered(call).expect("workflow renders");
        let definition = &root["jobs"][check.job];

        // The runner's own steps may: a machine never runs them.
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

        let runner = definition["runs-on"].as_str().unwrap_or_default();
        assert!(
            !runner.contains("macos") && !runner.contains("windows"),
            "{} runs on {runner}",
            check.id()
        );

        for (id, other) in root["jobs"].as_mapping().expect("jobs") {
            let dependents = other["needs"].as_sequence().into_iter().flatten();
            assert!(
                dependents
                    .filter_map(serde_yaml::Value::as_str)
                    .all(|need| need != check.job),
                "{} job {id:?} needs {}, so skipping one skips both",
                call.id,
                check.job
            );
        }
    }
}

/// The manifest is what a machine runs. It holds the job's steps as written,
/// with nothing left for a runner to fill in.
#[test]
fn a_machine_runs_the_scripts_the_workflow_holds() {
    for check in described().expect("checks render") {
        let call = call_of(check.call).expect("the check's call exists");
        let root = rendered(call).expect("workflow renders");
        let generated = &root["jobs"][check.job];

        for step in &check.steps {
            let listed = steps_of(generated)
                .find(|listed| listed["name"].as_str() == Some(&step.name))
                .expect("the step is in the generated job");
            assert_eq!(listed["run"].as_str(), Some(step.run.as_str()));
        }

        let values = check
            .env
            .values()
            .chain(check.steps.iter().flat_map(|step| step.env.values()));
        for value in values {
            assert!(
                !value.contains("${{") && !value.contains(RUNNER_HOME),
                "{}: `{value}` is a runner's to set",
                check.id
            );
        }
    }
}

/// A job that reads the list without being a check would be skipped by an
/// attestation nobody can make, and one that names another check's id would
/// be skipped by that check's pass.
#[test]
fn only_an_attested_job_skips_and_only_on_its_own_entry() {
    for call in pr_ci::CALLS {
        let root = rendered(call).expect("workflow renders");
        for (id, definition) in root["jobs"].as_mapping().expect("jobs") {
            let id = format!("{}/{}", call.id, id.as_str().expect("a job id"));
            let condition = definition["if"].as_str().unwrap_or_default();
            let clause = not_attested(&id).condition().0;

            if CHECKS.iter().any(|check| check.id() == id) {
                assert!(
                    condition == clause || condition.ends_with(&format!(" && {clause}")),
                    "{id}: `{condition}`"
                );
                assert_eq!(condition.matches("inputs.attested").count(), 1, "{id}");
            } else {
                assert!(
                    !condition.contains("inputs.attested"),
                    "{id}: `{condition}`"
                );
            }
        }
    }
}

/// A workflow that takes no `attested` input would fail to be called with one,
/// and one that is not handed it would never skip.
#[test]
fn pr_ci_hands_attestations_to_exactly_the_workflows_with_checks() {
    let yaml = pr_ci::pr_ci().to_string().expect("PR CI renders");
    let workflow: serde_yaml::Value = serde_yaml::from_str(&yaml).expect("PR CI parses");

    for call in pr_ci::CALLS {
        let called = rendered(call).expect("workflow renders");
        let takes = called["on"]["workflow_call"]["inputs"].get(INPUT).is_some();
        let handed = workflow["jobs"][call.id]["with"].get(INPUT).is_some();

        assert_eq!(takes, calls_attested(call), "{}", call.id);
        assert_eq!(handed, calls_attested(call), "{}", call.id);
    }
}

#[test]
fn a_pattern_widens_to_the_directory_it_stays_inside() {
    assert_eq!(widen("Cargo.lock"), "Cargo.lock");
    assert_eq!(widen("crates/**"), "crates");
    assert_eq!(widen("crates/**/Cargo.toml"), "crates");
    assert_eq!(widen("nix-support/node_modules*"), "nix-support");
    assert_eq!(widen("tooling/xtask/src/**"), "tooling/xtask/src");
    assert_eq!(widen("**/Cargo.toml"), ".");
    assert_eq!(widen("*.md"), ".");
}

#[test]
fn triggers_drop_what_a_listed_directory_already_holds() {
    let paths = [
        "crates/a",
        "crates",
        "flake.nix",
        "crates/b/c",
        "crates-extra",
    ];

    assert_eq!(
        without_nested(paths.iter().map(|path| (*path).to_owned()).collect()),
        vec!["crates", "crates-extra", "flake.nix"]
    );
    assert_eq!(
        without_nested(vec!["crates".to_owned(), ".".to_owned()]),
        vec!["."]
    );
}

/// `cargo x attest run all` leaves out a check whose triggers a branch did
/// not touch. A trigger missing here would leave out a check `PR CI` runs.
#[test]
fn a_checks_triggers_hold_every_path_that_makes_its_job_run() {
    for check in described().expect("checks render") {
        let call = call_of(check.call).expect("the check's call exists");
        let root = rendered(call).expect("workflow renders");
        let patterns: Vec<String> = match call.paths {
            Some(paths) => paths.iter().map(|path| path.as_str().to_owned()).collect(),
            None => selector_filters(&root).expect("a selector")["should_run"].clone(),
        };

        assert!(!patterns.is_empty(), "{} is filtered by nothing", check.id);
        for pattern in patterns {
            let inside = widen(&pattern);
            assert!(
                check.triggers.iter().any(|trigger| {
                    trigger == "."
                        || *trigger == inside
                        || inside.starts_with(&format!("{trigger}/"))
                }),
                "{}: `{pattern}` is not among its triggers",
                check.id
            );
        }
    }
}

/// A job a selector decides must read that decision in its own condition:
/// the triggers are taken from there.
#[test]
fn a_selected_check_reads_the_filter_its_triggers_come_from() {
    for check in CHECKS {
        let call = call_of(check.call).expect("the check's call exists");
        if call.paths.is_some() {
            continue;
        }
        let root = rendered(call).expect("workflow renders");
        let condition = root["jobs"][check.job]["if"].as_str().unwrap_or_default();

        assert!(
            condition.contains("needs.path-check.outputs.should_run"),
            "{}: `{condition}` does not read should_run",
            check.id()
        );
    }
}
