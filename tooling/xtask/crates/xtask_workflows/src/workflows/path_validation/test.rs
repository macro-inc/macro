use super::*;

#[test]
fn accepts_checkout_and_runtime_paths_in_their_respective_fields() {
    let yaml = r#"
on:
  pull_request:
    paths:
      - apps/web/**
jobs:
  check:
    steps:
      - name: Build
        working-directory: apps/web
        run: bun run build
      - name: Upload
        uses: actions/upload-artifact@v4
        with:
          path: artifacts/*
"#;
    validate("fixture.yml", yaml, &xtask_paths::repo_root()).unwrap();
}

#[test]
fn rejects_missing_working_directories() {
    let yaml = r#"
jobs:
  check:
    steps:
      - name: Broken
        working-directory: definitely-missing
        run: true
"#;
    let error = validate("fixture.yml", yaml, &xtask_paths::repo_root()).unwrap_err();
    let error = format!("{error:#}");
    assert!(error.contains("working directory"));
    assert!(error.contains("definitely-missing"));
}

#[test]
fn validates_negated_embedded_path_filters_like_positive_ones() {
    let yaml = r#"
jobs:
  check:
    steps:
      - name: Filter
        uses: dorny/paths-filter@v3
        with:
          filters: |
            changed:
              - apps/web/tauri/**
              - '!apps/web/tauri/android_*/**'
"#;
    validate("fixture.yml", yaml, &xtask_paths::repo_root()).unwrap();

    let yaml = yaml.replace("android_*", "definitely-missing");
    let error = validate("fixture.yml", &yaml, &xtask_paths::repo_root()).unwrap_err();
    assert!(format!("{error:#}").contains("matches no paths"));
}

#[test]
fn rejects_missing_embedded_path_filters() {
    let yaml = r#"
jobs:
  check:
    steps:
      - name: Filter
        uses: dorny/paths-filter@v3
        with:
          filters: |
            changed:
              - definitely-missing/**
"#;
    let error = validate("fixture.yml", yaml, &xtask_paths::repo_root()).unwrap_err();
    let error = format!("{error:#}");
    assert!(error.contains("dorny path-filter group `changed`"));
    assert!(error.contains("matches no paths"));
}

#[test]
fn planned_lexical_filter_requires_its_exact_group_and_committed_specification() {
    // Exercise an absent planned path even after that package has landed.
    let checkout = tempfile::tempdir().unwrap();
    let root = checkout.path();
    let specification = root.join("docs/design/lexical-port");
    std::fs::create_dir_all(&specification).unwrap();
    std::fs::copy(
        xtask_paths::repo_root().join("docs/design/lexical-port/S4-tests.md"),
        specification.join("S4-tests.md"),
    )
    .unwrap();
    let context = "workflow `pr-ci.yml` dorny path-filter group `lexical`";
    super::validate_glob("packages/lexical-wasm-shim/**", root, context.into()).unwrap();
    assert!(
        super::validate_glob("packages/lexical-wasm-shim/**", root, "other group".into()).is_err()
    );
    assert!(super::validate_glob("packages/misspelled-shim/**", root, context.into()).is_err());
    let empty = tempfile::tempdir().unwrap();
    assert!(
        super::validate_glob(
            "packages/lexical-wasm-shim/**",
            empty.path(),
            context.into()
        )
        .is_err()
    );
}
