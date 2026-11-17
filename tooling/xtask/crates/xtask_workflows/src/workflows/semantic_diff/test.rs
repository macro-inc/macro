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

#[test]
fn expression_spelling_is_not_semantic_but_its_meaning_is() {
    let before = "jobs:\n  a:\n    if: (a.x=='1') || b.y\n    env:\n      X: pr-${{github.sha}}\n";
    let same = "jobs:\n  a:\n    if: a.x == '1' || b.y\n    env:\n      X: pr-${{ github.sha }}\n";
    let changed =
        "jobs:\n  a:\n    if: a.x == '1' && b.y\n    env:\n      X: pr-${{ github.ref }}\n";

    assert_eq!(
        diff_file("w.yml", Some(before), Some(same)).unwrap(),
        Vec::<String>::new()
    );
    assert_eq!(
        diff_file("w.yml", Some(before), Some(changed)).unwrap(),
        vec![
            "w.yml.jobs.a.if: \"(a.x=='1') || b.y\" -> \"a.x == '1' && b.y\"",
            "w.yml.jobs.a.env.X: \"pr-${{github.sha}}\" -> \"pr-${{ github.ref }}\"",
        ]
    );
}
