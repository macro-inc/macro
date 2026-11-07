use serde_json::{Value, json};

use super::*;

fn conditions(value: Value) -> PayloadConditions {
    serde_json::from_value(value).unwrap()
}

fn workflow_run(name: &str, branch: &str, conclusion: Value) -> Value {
    json!({
        "action": "completed",
        "workflow_run": {
            "name": name,
            "head_branch": branch,
            "conclusion": conclusion,
            "pull_requests": [{ "number": 7 }, { "number": 9 }],
        }
    })
}

#[test]
fn a_specific_workflow_failing_on_release_branches_matches_only_that() {
    let failed_ci_on_release = conditions(json!([
        { "path": ["workflow_run", "name"], "equals": "CI" },
        { "path": ["workflow_run", "head_branch"], "glob": "release/*" },
        { "path": ["workflow_run", "conclusion"], "in": ["failure", "timed_out"] },
    ]));

    let matches = |payload: Value| failed_ci_on_release.matches(Some(&payload));
    assert!(matches(workflow_run("CI", "release/2.1", json!("failure"))));
    assert!(matches(workflow_run(
        "CI",
        "release/2.1",
        json!("timed_out")
    )));
    assert!(!matches(workflow_run(
        "CI",
        "release/2.1",
        json!("success")
    )));
    assert!(!matches(workflow_run(
        "Lint",
        "release/2.1",
        json!("failure")
    )));
    assert!(!matches(workflow_run("CI", "main", json!("failure"))));
}

#[test]
fn not_in_passes_when_no_value_is_listed_including_none_at_all() {
    let not_success = conditions(json!([
        { "path": ["workflow_run", "conclusion"], "notIn": ["success"] },
    ]));

    assert!(not_success.matches(Some(&workflow_run("CI", "main", json!("failure")))));
    assert!(not_success.matches(Some(&workflow_run("CI", "main", Value::Null))));
    assert!(not_success.matches(Some(&json!({}))));
    assert!(!not_success.matches(Some(&workflow_run("CI", "main", json!("success")))));
}

#[test]
fn every_element_step_matches_any_array_item() {
    let labelled_bug = conditions(json!([
        { "path": ["pull_request", "labels", "*", "name"], "equals": "bug" },
    ]));
    let pr = |labels: Value| json!({ "pull_request": { "labels": labels } });

    assert!(labelled_bug.matches(Some(&pr(json!([{ "name": "ui" }, { "name": "bug" }])))));
    assert!(!labelled_bug.matches(Some(&pr(json!([{ "name": "ui" }])))));
    assert!(!labelled_bug.matches(Some(&pr(json!([])))));
}

#[test]
fn index_step_reads_one_element() {
    let first_pr = conditions(json!([
        { "path": ["workflow_run", "pull_requests", "0", "number"], "equals": 7 },
    ]));

    assert!(first_pr.matches(Some(&workflow_run("CI", "main", json!("failure")))));
}

#[test]
fn exists_treats_null_as_absent() {
    let concluded = conditions(json!([
        { "path": ["workflow_run", "conclusion"], "exists": true },
    ]));
    let running = conditions(json!([
        { "path": ["workflow_run", "conclusion"], "exists": false },
    ]));
    let in_progress = workflow_run("CI", "main", Value::Null);

    assert!(!concluded.matches(Some(&in_progress)));
    assert!(running.matches(Some(&in_progress)));
    assert!(concluded.matches(Some(&workflow_run("CI", "main", json!("success")))));
}

#[test]
fn an_absent_payload_matches_nothing() {
    let not_success = conditions(json!([
        { "path": ["workflow_run", "conclusion"], "notIn": ["success"] },
    ]));

    assert!(!not_success.matches(None));
}

#[test]
fn a_test_needs_exactly_one_comparison_and_scalar_values() {
    let parse = |value: Value| serde_json::from_value::<PayloadConditions>(value);

    assert!(parse(json!([{ "path": ["a"] }])).is_err());
    assert!(parse(json!([{ "path": ["a"], "equals": 1, "exists": true }])).is_err());
    assert!(parse(json!([{ "path": ["a"], "equals": { "b": 1 } }])).is_err());
    assert!(parse(json!([{ "path": ["a"], "in": [] }])).is_err());
    assert!(parse(json!([{ "path": [], "equals": 1 }])).is_err());
    assert!(parse(json!([{ "path": [" "], "equals": 1 }])).is_err());
    assert!(parse(json!([{ "path": ["a"], "glob": "[" }])).is_err());
    assert!(parse(json!([])).is_err());
}

#[test]
fn conditions_round_trip_in_canonical_order() {
    let parsed = conditions(json!([
        { "path": ["b"], "in": ["y", "x", "x"] },
        { "path": ["a"], "equals": true },
    ]));

    assert_eq!(
        serde_json::to_value(&parsed).unwrap(),
        json!([
            { "path": ["a"], "equals": true },
            { "path": ["b"], "in": ["x", "y"] },
        ])
    );
}

#[test]
fn descriptions_read_as_the_test() {
    let parsed = conditions(json!([
        { "path": ["workflow_run", "conclusion"], "in": ["failure"] },
        { "path": ["ref"], "glob": "refs/heads/*" },
    ]));
    let described: Vec<String> = parsed.as_slice().iter().map(|c| c.describe()).collect();

    assert_eq!(
        described,
        vec![
            "ref matches refs/heads/*",
            "workflow_run.conclusion in [\"failure\"]",
        ]
    );
}
