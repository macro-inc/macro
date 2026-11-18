use indexmap::IndexMap;

use super::to_string;

#[test]
fn a_workflow_shape_renders_in_block_style() {
    let mut step = IndexMap::new();
    step.insert("name", serde_json::json!("Build"));
    step.insert("run", serde_json::json!("cargo build\ncargo test\n"));
    // Nested maps pass through `serde_json::Value`, whose key order depends on
    // whether some crate in the build enables `preserve_order`; keys go in
    // sorted order so both orders agree.
    let mut job = IndexMap::new();
    job.insert("needs", serde_json::json!([]));
    job.insert("runs-on", serde_json::json!("small"));
    job.insert("steps", serde_json::json!([step]));
    let mut push = IndexMap::new();
    push.insert("branches", vec!["main"]);
    let mut on = IndexMap::new();
    on.insert("push", serde_json::to_value(push).unwrap());
    on.insert("workflow_dispatch", serde_json::json!({}));
    let mut jobs = IndexMap::new();
    jobs.insert("build", job);
    let mut workflow = IndexMap::new();
    workflow.insert("name", serde_json::json!("CI"));
    workflow.insert("on", serde_json::to_value(on).unwrap());
    workflow.insert("jobs", serde_json::to_value(jobs).unwrap());

    assert_eq!(
        to_string(&workflow).unwrap(),
        "name: CI\n\
         on:\n  \
           push:\n    \
             branches:\n      \
               - main\n  \
           workflow_dispatch: {}\n\
         jobs:\n  \
           build:\n    \
             needs: []\n    \
             runs-on: small\n    \
             steps:\n      \
               - name: Build\n        \
                 run: |\n          \
                   cargo build\n          \
                   cargo test\n"
    );
}

/// Every string YAML could misread is quoted or written as a block, so a
/// parser gets back exactly what was serialized.
#[test]
fn strings_read_back_unchanged() {
    let strings = [
        "plain words",
        "\techo a\necho b\n",
        "a\u{2028}b",
        "line\u{2029}\nnext\n",
        "\u{feff}x",
        "${{ github.event_name == 'push' && 'a' || 'b' }}",
        "true",
        "on",
        "No",
        "null",
        "~",
        "20",
        "1.3.13",
        "0x1f",
        "2026-01-01",
        "12:30",
        ".inf",
        "-1",
        "--check",
        "-",
        "- item",
        "**/*.rs",
        "./.github/actions/setup-nix",
        "key: value",
        "trailing:",
        "a #comment",
        "#comment",
        "it's",
        "\"quoted\"",
        "  leading space",
        "trailing space ",
        "",
        "tab\tinside",
        "bell\u{7}",
        "one line\n",
        "no trailing newline\nsecond",
        "kept blank lines\n\n\n",
        "\nstarts blank",
        " indented first\nline",
        "line with trailing spaces   \nnext\n",
        "  nested\n    deeper\nback\n",
        "unicode — ✓\n",
    ];

    for text in strings {
        let mut wrapper = IndexMap::new();
        wrapper.insert("value", vec![text]);
        let yaml = to_string(&wrapper).unwrap();
        let parsed: IndexMap<String, Vec<String>> = serde_yaml::from_str(&yaml)
            .unwrap_or_else(|error| panic!("{text:?} rendered unparsable YAML {yaml:?}: {error}"));

        assert_eq!(
            parsed["value"],
            vec![text.to_string()],
            "rendered as {yaml:?}"
        );
    }
}

#[test]
fn scalars_keep_their_types() {
    let mut values = IndexMap::new();
    values.insert("bool", serde_json::json!(false));
    values.insert("int", serde_json::json!(15));
    values.insert("null", serde_json::Value::Null);
    values.insert("string-bool", serde_json::json!("false"));

    assert_eq!(
        to_string(&values).unwrap(),
        "bool: false\nint: 15\n'null': null\nstring-bool: 'false'\n"
    );
}

#[test]
fn zizmor_ignores_render_on_the_line_zizmor_reports() {
    let steps: Vec<crate::StepValue> = vec![
        crate::Step::new("Checkout")
            .uses("actions", "checkout", "abc")
            .add_with(("fetch-depth", "0"))
            .zizmor_ignore(crate::ZizmorRule::Artipacked, "later steps push")
            .into(),
        crate::Step::new("Export")
            .run("echo A=1 >> \"$GITHUB_ENV\"\necho done\n")
            .zizmor_ignore(crate::ZizmorRule::GithubEnv, "exports for later steps")
            .into(),
    ];

    assert_eq!(
        to_string(&steps).unwrap(),
        "- name: Checkout # zizmor: ignore[artipacked] later steps push\n  \
         uses: actions/checkout@abc\n  \
         with:\n    \
         fetch-depth: '0'\n\
         - name: Export\n  \
         run: | # zizmor: ignore[github-env] exports for later steps\n    \
         echo A=1 >> \"$GITHUB_ENV\"\n    \
         echo done\n"
    );
}

#[test]
fn a_schedule_comment_renders_on_its_cron_line() {
    let schedules = vec![crate::Schedule::new("0 21 * * *").comment("21:00 UTC is 4pm EST")];

    assert_eq!(
        to_string(&schedules).unwrap(),
        "- cron: 0 21 * * * # 21:00 UTC is 4pm EST\n"
    );
}
