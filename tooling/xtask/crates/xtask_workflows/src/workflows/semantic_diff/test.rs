use super::diff_file;

#[test]
fn spelling_and_key_order_are_not_semantic() {
    let before = "name: CI\non:\n  push:\n    branches: [main]\njobs:\n  a:\n    runs-on: small\n    steps:\n    - run: |\n        echo hi\n";
    let after = "# DO NOT EDIT\njobs:\n  a:\n    steps:\n      - run: \"echo hi\\n\"\n    runs-on: 'small'\non:\n  push:\n    branches:\n      - main\nname: \"CI\"\n";

    assert_eq!(
        diff_file("w.yml", Some(before), Some(after)).unwrap(),
        Vec::<String>::new()
    );
}

#[test]
fn changed_added_and_removed_values_are_listed_by_path() {
    let before =
        "jobs:\n  a:\n    name: CI gate\n    timeout-minutes: 5\n    steps:\n    - run: one\n";
    let after = "jobs:\n  a:\n    name: CI Gate\n    if: always()\n    steps:\n    - run: one\n    - run: two\n";

    assert_eq!(
        diff_file("w.yml", Some(before), Some(after)).unwrap(),
        vec![
            "w.yml.jobs.a.name: \"CI gate\" -> \"CI Gate\"",
            "w.yml.jobs.a.timeout-minutes: removed",
            "w.yml.jobs.a.steps: 1 item(s) before, 2 after",
            "w.yml.jobs.a.if: added",
        ]
    );
}

#[test]
fn a_string_and_a_boolean_are_different_values() {
    let before = "with:\n  clean: false\n";
    let after = "with:\n  clean: 'false'\n";

    assert_eq!(
        diff_file("w.yml", Some(before), Some(after)).unwrap(),
        vec!["w.yml.with.clean: false -> \"false\""]
    );
}
