use super::{Consumer, consumers};

#[test]
fn reads_each_image_build_with_its_dockerfile_and_build_arguments() {
    let stack = "const image = new Image('a', {\n        dockerfile: 'docker/Dockerfile',\n        platform,\n        buildArgs: {\n          SERVICE_NAME: 'pubsub_workers',\n          PACKAGE_NAME: \"email_service\",\n        },\n});\nconst worker = new Image('b', {\n        dockerfile: `${REPO_ROOT}/docker/Dockerfile.sha-cleanup-worker`,\n});\n";
    assert_eq!(
        consumers("infra/stacks/x.ts", stack).unwrap(),
        [
            Consumer {
                source: "infra/stacks/x.ts:2".into(),
                dockerfile: "docker/Dockerfile".into(),
                args: [
                    ("PACKAGE_NAME".into(), "email_service".into()),
                    ("SERVICE_NAME".into(), "pubsub_workers".into())
                ]
                .into(),
            },
            Consumer {
                source: "infra/stacks/x.ts:10".into(),
                dockerfile: "docker/Dockerfile.sha-cleanup-worker".into(),
                args: Default::default(),
            },
        ]
    );
}

#[test]
fn shapes_outside_the_grammar_fail() {
    for (stack, expected) in [
        (
            "new Image('a', {\n  dockerfile: dockerfilePath,\n});\n",
            "dockerfile is not a string literal",
        ),
        (
            "dockerfile: 'docker/Dockerfile',\n",
            "dockerfile is not inside an object literal",
        ),
        (
            "new Image('a', {\n  dockerfile: 'docker/Dockerfile',\n  buildArgs: { SERVICE_NAME: name },\n});\n",
            "is not NAME: 'literal'",
        ),
        (
            "new Image('a', {\n  dockerfile: 'docker/Dockerfile',\n  buildArgs: { ...shared, SERVICE_NAME: 'a' },\n});\n",
            "is not NAME: 'literal'",
        ),
        (
            "new Image('a', {\n  dockerfile: 'docker/Dockerfile',\n  buildArgs: { A: 'a' },\n  buildArgs: { B: 'b' },\n});\n",
            "several buildArgs",
        ),
        (
            "new Image('a', {\n  dockerfile: 'docker/Dockerfile',\n  build: { buildArgs: { A: 'a' } },\n});\n",
            "buildArgs is not in the object of a literal dockerfile",
        ),
        (
            "new Image('a', {\n  dockerfile: 'docker/Dockerfile',\n});\nconst options = { buildArgs: { PACKAGE_NAME: 'x' } };\n",
            "buildArgs is not in the object of a literal dockerfile",
        ),
        (
            "new Image('a', {\n  dockerfile: 'docker/Dockerfile',\n",
            "unbalanced braces",
        ),
    ] {
        let error = consumers("infra/stacks/x.ts", stack).unwrap_err();
        assert!(error.contains(expected), "{stack}: {error}");
    }
}

/// A later, unrelated call's `buildArgs` must not supply values to an
/// earlier image build that has none.
#[test]
fn build_arguments_bind_only_within_their_own_object() {
    let stack = "const image = new Image('a', {\n  dockerfile: 'docker/Dockerfile',\n});\nconst other = new Image('b', {\n  dockerfile: 'docker/Dockerfile.x',\n  buildArgs: { PACKAGE_NAME: 'x' },\n});\n";
    let found = consumers("infra/stacks/x.ts", stack).unwrap();
    assert_eq!(found[0].args, Default::default());
    assert_eq!(found[1].args, [("PACKAGE_NAME".into(), "x".into())].into());
}

#[test]
fn alternate_keys_cannot_hide_a_second_image_build() {
    let safe = "new Image('safe', { dockerfile: 'docker/Dockerfile', buildArgs: { PACKAGE_NAME: 'safe' } });";
    for hidden in [
        r#"new Image('hidden', { "dockerfile": 'docker/Dockerfile', "buildArgs": { PACKAGE_NAME: 'unsafe' } });"#,
        "new Image('hidden', { dockerfile : dynamic, buildArgs : dynamic });",
        "new Image('hidden', { ['dockerfile']: dynamic, ['buildArgs']: dynamic });",
    ] {
        let text = format!("{safe}\n{hidden}");
        assert!(
            consumers("infra/stacks/x.ts", &text).is_err(),
            "hidden build accepted: {hidden}"
        );
    }
}

#[test]
fn enclosing_image_overrides_cannot_replace_literal_build_selection() {
    for image in [
        "new Image('a', { dockerfile: 'docker/Dockerfile', buildArgs: { PACKAGE_NAME: 'safe' }, ...overrides });",
        "new Image('a', { ...overrides, dockerfile: 'docker/Dockerfile', buildArgs: { PACKAGE_NAME: 'safe' } });",
        "new Image('a', { dockerfile: 'docker/Dockerfile', buildArgs: { PACKAGE_NAME: 'safe' }, [key]: replacement });",
    ] {
        assert!(
            consumers("infra/stacks/x.ts", image).is_err(),
            "dynamic image accepted: {image}"
        );
    }
}

#[test]
fn property_whitespace_and_comments_do_not_hide_literal_bindings() {
    let text = "// dockerfile: notAConsumer\nconst x = { dockerfile : 'docker/Dockerfile', buildArgs : { PACKAGE_NAME: 'safe' } };";
    let found = consumers("infra/stacks/x.ts", text).unwrap();
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].args["PACKAGE_NAME"], "safe");
}

#[test]
fn escaped_property_spellings_cannot_hide_a_second_literal_image() {
    let safe = "new Image('safe', { dockerfile: 'docker/Dockerfile', buildArgs: { PACKAGE_NAME: 'safe' } });";
    let mut accepted = Vec::new();
    for hidden in [
        r#"new Image('hidden', { "docker\u0066ile": 'docker/Dockerfile', "build\u0041rgs": { PACKAGE_NAME: 'unsafe' } });"#,
        r#"new Image('hidden', { 'docker\x66ile': 'docker/Dockerfile', 'build\x41rgs': { PACKAGE_NAME: 'unsafe' } });"#,
    ] {
        if consumers("infra/stacks/x.ts", &format!("{safe}\n{hidden}")).is_ok() {
            accepted.push(hidden);
        }
    }
    assert!(
        accepted.is_empty(),
        "escaped property consumers accepted: {accepted:?}"
    );
}

#[test]
fn escaped_string_values_are_not_mistaken_for_escaped_property_keys() {
    let text = r#"new Image('safe', { dockerfile: 'docker/Dockerfile', buildArgs: { PACKAGE_NAME: 'safe' }, description: '\u0031' });"#;
    assert_eq!(consumers("infra/stacks/x.ts", text).unwrap().len(), 1);
}

#[test]
fn javascript_whitespace_and_line_terminators_preserve_image_keys() {
    let text = "// comment\u{2028}new Image('safe', { dockerfile\u{00a0}: 'docker/Dockerfile', buildArgs\u{feff}: { PACKAGE_NAME: 'safe' } });";
    let found = consumers("infra/stacks/x.ts", text).unwrap();
    assert_eq!(found.len(), 1);
    assert_eq!(found[0].args["PACKAGE_NAME"], "safe");
}

#[test]
fn unicode_identifier_escape_families_cannot_hide_literal_image_keys() {
    let safe = "new Image('safe', { dockerfile: 'docker/Dockerfile', buildArgs: { PACKAGE_NAME: 'safe' } });";
    let mut accepted = Vec::new();
    for hidden in [
        r#"new Image('hidden', { docker\u0066ile: 'docker/Dockerfile', build\u0041rgs: { PACKAGE_NAME: 'unsafe' } });"#,
        r#"new Image('hidden', { \u0064ockerfile: 'docker/Dockerfile', \u0062uildArgs: { PACKAGE_NAME: 'unsafe' } });"#,
        r#"new Image('hidden', { docker\u{66}ile: 'docker/Dockerfile', build\u{41}rgs: { PACKAGE_NAME: 'unsafe' } });"#,
        r#"new Image('hidden', { docker\u{000000000000066}ile: 'docker/Dockerfile', build\u{000000000000041}rgs: { PACKAGE_NAME: 'unsafe' } });"#,
    ] {
        if consumers("infra/stacks/x.ts", &format!("{safe}\n{hidden}")).is_ok() {
            accepted.push(hidden);
        }
    }
    assert!(
        accepted.is_empty(),
        "Unicode identifier consumers accepted: {accepted:?}"
    );
}
