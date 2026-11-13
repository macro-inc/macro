use super::*;

#[test]
fn module_tree_follows_declarations_and_finds_every_test_form() {
    let crate_dir = tempfile::tempdir().unwrap();
    let src = crate_dir.path().join("src");
    std::fs::create_dir_all(src.join("api/handlers")).unwrap();
    std::fs::create_dir_all(src.join("shared")).unwrap();
    std::fs::write(
        src.join("main.rs"),
        "mod api;\n#[path = \"shared/helpers.rs\"]\nmod helpers;\nmod inline { mod nested; }\nfn main() {}\n",
    )
    .unwrap();
    std::fs::write(
        src.join("api.rs"),
        "mod handlers;\n#[cfg(test)]\nmod test;\n",
    )
    .unwrap();
    std::fs::write(src.join("api/handlers/mod.rs"), "mod list;\n").unwrap();
    std::fs::write(
        src.join("api/handlers/list.rs"),
        "#[tokio::test(flavor = \"multi_thread\")]\nasync fn lists() {}\n",
    )
    .unwrap();
    std::fs::write(src.join("api/test.rs"), "#[cfg(test)]\nfn only_cfg() {}\n").unwrap();
    std::fs::write(
        src.join("shared/helpers.rs"),
        "macro_rules! cases { () => { #[test] fn case() {} }; }\n",
    )
    .unwrap();
    std::fs::create_dir_all(src.join("inline")).unwrap();
    std::fs::write(
        src.join("inline/nested.rs"),
        "proptest::proptest! { fn holds(x in 0..1u8) {} }\n",
    )
    .unwrap();
    std::fs::write(
        src.join("unreached.rs"),
        "#[test]\nfn never_declared() {}\n",
    )
    .unwrap();

    let files = module_files(&src.join("main.rs")).unwrap();
    assert_eq!(
        files,
        BTreeSet::from([
            src.join("main.rs"),
            src.join("api.rs"),
            src.join("api/handlers/mod.rs"),
            src.join("api/handlers/list.rs"),
            src.join("api/test.rs"),
            src.join("shared/helpers.rs"),
            src.join("inline/nested.rs"),
        ])
    );

    let mut holds_test = BTreeMap::new();
    let with_tests: BTreeSet<PathBuf> = files
        .into_iter()
        .filter(|file| file_holds_test(file, &mut holds_test).unwrap())
        .collect();
    assert_eq!(
        with_tests,
        BTreeSet::from([
            src.join("api/handlers/list.rs"),
            src.join("shared/helpers.rs"),
            src.join("inline/nested.rs"),
        ])
    );
}

#[test]
fn flags_binaries_that_only_repeat_tests_and_tests_that_never_run() {
    let crate_dir = tempfile::tempdir().unwrap();
    let src = crate_dir.path().join("src");
    std::fs::create_dir_all(src.join("bin")).unwrap();
    std::fs::write(src.join("main.rs"), "mod api;\nfn main() {}\n").unwrap();
    std::fs::write(src.join("openapi.rs"), "mod api;\nfn main() {}\n").unwrap();
    std::fs::write(src.join("api.rs"), "#[test]\nfn serves() {}\n").unwrap();
    std::fs::write(src.join("lib.rs"), "pub fn shared() {}\n").unwrap();
    std::fs::write(
        src.join("bin/backfill.rs"),
        "fn main() {}\n#[test]\nfn backfills() {}\n",
    )
    .unwrap();
    let manifest = crate_dir.path().join("Cargo.toml");
    let package = Package {
        name: "service".to_owned(),
        manifest: manifest.clone(),
        targets: vec![
            Target {
                kind: TargetKind::Library,
                name: "service".to_owned(),
                tested: true,
                root: src.join("lib.rs"),
            },
            Target {
                kind: TargetKind::Binary,
                name: "service".to_owned(),
                tested: true,
                root: src.join("main.rs"),
            },
            Target {
                kind: TargetKind::Binary,
                name: "service_openapi".to_owned(),
                tested: false,
                root: src.join("openapi.rs"),
            },
            Target {
                kind: TargetKind::Binary,
                name: "backfill".to_owned(),
                tested: false,
                root: src.join("bin/backfill.rs"),
            },
        ],
    };

    let messages: Vec<String> = check(&[package])
        .unwrap()
        .iter()
        .map(ToString::to_string)
        .collect();
    assert_eq!(
        messages,
        vec![
            format!(
                "{}: lib `service` builds a test binary that runs no test of its own. Set `test = false` on it.",
                manifest.display()
            ),
            format!(
                "{}: bin `backfill` has `test = false`, so these tests never run. Remove `test = false`, or move them into a tested target:\n  {}",
                manifest.display(),
                src.join("bin/backfill.rs").display()
            ),
        ]
    );
}

#[test]
fn flags_a_second_tested_integration_test_binary() {
    let crate_dir = tempfile::tempdir().unwrap();
    let tests = crate_dir.path().join("tests");
    std::fs::create_dir_all(tests.join("it")).unwrap();
    std::fs::write(tests.join("it/main.rs"), "mod engine;\n").unwrap();
    std::fs::write(tests.join("it/engine.rs"), "#[test]\nfn runs() {}\n").unwrap();
    std::fs::write(tests.join("search.rs"), "#[test]\nfn searches() {}\n").unwrap();
    std::fs::write(
        tests.join("service_binary_builds.rs"),
        "#[test]\nfn builds() {}\n",
    )
    .unwrap();
    let manifest = crate_dir.path().join("Cargo.toml");
    let package = Package {
        name: "cache".to_owned(),
        manifest: manifest.clone(),
        targets: vec![
            Target {
                kind: TargetKind::IntegrationTest,
                name: "it".to_owned(),
                tested: true,
                root: tests.join("it/main.rs"),
            },
            Target {
                kind: TargetKind::IntegrationTest,
                name: "search".to_owned(),
                tested: true,
                root: tests.join("search.rs"),
            },
            Target {
                kind: TargetKind::IntegrationTest,
                name: "service_binary_builds".to_owned(),
                tested: false,
                root: tests.join("service_binary_builds.rs"),
            },
        ],
    };

    let messages: Vec<String> = check(&[package])
        .unwrap()
        .iter()
        .map(ToString::to_string)
        .collect();
    assert_eq!(
        messages,
        vec![format!(
            "{}: each of `it`, `search` builds its own test binary. Move them into `tests/it/`, one module each, declared from `tests/it/main.rs`.",
            manifest.display()
        )]
    );
}
