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
    let before = "jobs:\n  a:\n    timeout-minutes: 5\n    env:\n      CLEAN: false\n";
    let after = "jobs:\n  a:\n    timeout-minutes: '5'\n    env:\n      CLEAN: 'false'\n";

    assert_eq!(
        diff_file("w.yml", Some(before), Some(after)).unwrap(),
        vec![
            "w.yml.jobs.a.timeout-minutes: 5 -> \"5\"",
            "w.yml.jobs.a.env.CLEAN: false -> \"false\"",
        ]
    );
}

#[test]
fn an_action_input_equals_its_string_spelling() {
    let before = "jobs:\n  a:\n    steps:\n    - uses: actions/checkout@abc\n      with:\n        persist-credentials: false\n        fetch-depth: 0\n    - uses: ./.github/actions/setup-rust\n      with:\n        rust-cache: true\n";
    let same = "jobs:\n  a:\n    steps:\n    - uses: actions/checkout@abc\n      with:\n        persist-credentials: 'false'\n        fetch-depth: '0'\n    - uses: ./.github/actions/setup-rust\n      with:\n        rust-cache: 'true'\n";
    let changed = "jobs:\n  a:\n    steps:\n    - uses: actions/checkout@abc\n      with:\n        persist-credentials: 'true'\n        fetch-depth: '1'\n    - uses: ./.github/actions/setup-rust\n      with:\n        rust-cache: 'false'\n";

    assert_eq!(
        diff_file("w.yml", Some(before), Some(same)).unwrap(),
        Vec::<String>::new()
    );
    assert_eq!(
        diff_file("w.yml", Some(before), Some(changed)).unwrap(),
        vec![
            "w.yml.jobs.a.steps[0].with.persist-credentials: false -> \"true\"",
            "w.yml.jobs.a.steps[0].with.fetch-depth: 0 -> \"1\"",
            "w.yml.jobs.a.steps[1].with.rust-cache: true -> \"false\"",
        ]
    );
}

#[test]
fn a_reusable_workflow_input_keeps_its_type() {
    let before =
        "jobs:\n  a:\n    uses: ./.github/workflows/deploy.yml\n    with:\n      notify: true\n";
    let after =
        "jobs:\n  a:\n    uses: ./.github/workflows/deploy.yml\n    with:\n      notify: 'true'\n";

    assert_eq!(
        diff_file("w.yml", Some(before), Some(after)).unwrap(),
        vec!["w.yml.jobs.a.with.notify: true -> \"true\""]
    );
}

#[test]
fn an_empty_trigger_is_null_or_an_empty_mapping() {
    let before = "on:\n  workflow_dispatch:\n  push:\n    branches: [main]\n";
    let same = "on:\n  workflow_dispatch: {}\n  push:\n    branches: [main]\n";
    let changed = "on:\n  workflow_dispatch:\n    inputs: {}\n  push: {}\n";

    assert_eq!(
        diff_file("w.yml", Some(before), Some(same)).unwrap(),
        Vec::<String>::new()
    );
    assert_eq!(
        diff_file("w.yml", Some(before), Some(changed)).unwrap(),
        vec![
            "w.yml.on.workflow_dispatch: null -> {\"inputs\":{}}",
            "w.yml.on.push.branches: removed",
        ]
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

#[test]
fn only_conditions_compare_as_expressions() {
    let before = "jobs:\n  a:\n    if: a == 'x'\n    steps:\n    - uses: o/r@v\n      with:\n        if: a=='x'\n";
    let after = "jobs:\n  a:\n    if: (a == 'x')\n    steps:\n    - uses: o/r@v\n      with:\n        if: (a == 'x')\n";

    assert_eq!(
        diff_file("w.yml", Some(before), Some(after)).unwrap(),
        vec!["w.yml.jobs.a.steps[0].with.if: \"a=='x'\" -> \"(a == 'x')\""]
    );
}

#[test]
fn a_float_action_input_differs_from_its_string_spelling() {
    let before = "jobs:\n  a:\n    steps:\n    - uses: o/r@v\n      with:\n        version: 3.0\n";
    let after = "jobs:\n  a:\n    steps:\n    - uses: o/r@v\n      with:\n        version: '3.0'\n";

    assert_eq!(
        diff_file("w.yml", Some(before), Some(after)).unwrap(),
        vec!["w.yml.jobs.a.steps[0].with.version: 3.0 -> \"3.0\""]
    );
}
