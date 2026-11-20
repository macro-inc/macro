use std::collections::BTreeMap;

use super::render;
use crate::workflows::{cla, pr_ci};

#[test]
fn called_jobs_are_named_after_their_caller() {
    let workflows = BTreeMap::from([
        (
            "caller.yml".to_string(),
            "jobs:\n  web-app:\n    name: Web App\n    uses: ./.github/workflows/callee.yml\n  plain:\n    runs-on: small\n".to_string(),
        ),
        (
            "callee.yml".to_string(),
            "jobs:\n  typecheck:\n    name: Typecheck\n  lint:\n    runs-on: small\n".to_string(),
        ),
    ]);

    let lock = render(&workflows).unwrap();
    let checks: Vec<&str> = lock
        .lines()
        .filter(|line| line.starts_with("check\t"))
        .collect();

    assert_eq!(
        checks,
        vec![
            "check\tcallee.yml\ttypecheck\tTypecheck",
            "check\tcallee.yml\tlint\tlint",
            "check\tcaller.yml\tweb-app/typecheck\tWeb App / Typecheck",
            "check\tcaller.yml\tweb-app/lint\tWeb App / lint",
            "check\tcaller.yml\tplain\tplain",
        ]
    );
}

#[test]
fn required_statuses_are_posted_by_their_workflows() {
    let pr_ci = pr_ci::pr_ci().to_string().unwrap();
    let cla = cla::cla().to_string().unwrap();

    assert!(pr_ci.contains("CI_GATE_CONTEXT: CI gate"));
    assert!(cla.contains("const STATUS_CONTEXT = 'cla';"));
}

#[test]
fn script_read_jobs_exist_in_pr_ci() {
    let pr_ci: serde_yaml::Value =
        serde_yaml::from_str(&pr_ci::pr_ci().to_string().unwrap()).unwrap();
    let names: Vec<&str> = pr_ci["jobs"]
        .as_mapping()
        .unwrap()
        .values()
        .filter_map(|job| job["name"].as_str())
        .collect();

    assert!(names.contains(&"Start"));
    assert!(names.contains(&"CI gate"));
}
