use super::*;

#[test]
fn inventory_only_changes_run_live_config_validation() {
    let filters = serde_json::to_string(&paths_filter().value.with).unwrap();
    assert!(filters.contains(".github/services-config.json"));
    let job = serde_json::to_value(check()).unwrap();
    assert!(!job["if"].as_str().unwrap().contains("rust_packages"));
}

#[test]
fn package_selection_does_not_pass_lib() {
    let script = include_str!("../scripts/run_tests.sh");
    assert!(
        script.contains(r#"cargo nextest run "${common[@]}" "${pkg_args[@]}""#),
        "the -p path must use the unconstrained selected flags, not --lib: {script}"
    );
    assert!(
        !script.contains(r#"--lib --bins --tests "${common[@]}" "${pkg_args[@]}""#),
        "--lib --bins --tests with -p fails for bin-only xtask crates"
    );
}

#[test]
fn tests_continue_to_exclude_sync_service() {
    let script = include_str!("../scripts/run_tests.sh");
    assert!(
        script.contains("--workspace --exclude sync_service"),
        "the full suite must preserve its historical sync_service exclusion"
    );
    assert!(
        script.contains(r#"[ "$package" = "sync_service" ] || pkg_args+=(-p "$package")"#),
        "targeted test runs must also exclude sync_service"
    );
}

#[test]
fn sqlx_only_clippies_and_skips_live_tests() {
    let script = include_str!("../scripts/compute_nextest_filter.sh");
    let start = script
        .find("if ! grep -qvE '^\\.sqlx/'")
        .expect("sqlx-only short-circuit must remain");
    let sqlx_block = script[start..]
        .split("packages=\"$(cargo run")
        .next()
        .unwrap();
    assert!(
        sqlx_block.contains(r#"rust_packages=all"#),
        "sqlx-only must emit all for clippy, not none: {sqlx_block}"
    );
    assert!(
        !sqlx_block.contains(r#"rust_packages=none"#),
        "sqlx-only must not skip clippy: {sqlx_block}"
    );
    assert!(
        sqlx_block.contains(r#"skip_tests=true"#),
        "sqlx-only diffs must not run the live-Postgres suite: {sqlx_block}"
    );
}

#[test]
fn test_job_honors_skip_tests() {
    let yaml = code_check_cloud_storage()
        .to_string()
        .expect("workflow yaml");
    assert!(
        yaml.contains("needs.path-check.outputs.skip_tests != 'true'"),
        "test job must skip when skip_tests is set: {yaml}"
    );
    assert!(
        yaml.contains("skip_tests: ${{ steps.nextest-filter.outputs.skip_tests }}"),
        "path-check must export skip_tests: {yaml}"
    );
}

#[test]
fn tests_build_dependencies_without_debug_info() {
    let script = include_str!("../scripts/run_tests.sh");
    assert!(
        script.contains(r#"--config 'profile.dev.package."*".debug=false'"#),
        "the test build must drop dependency debug info: {script}"
    );
}

#[test]
fn test_job_keeps_one_sccache_server_for_the_whole_run() {
    let job = serde_json::to_value(test()).unwrap();
    assert_eq!(job["env"]["SCCACHE_IDLE_TIMEOUT"], "0");
    let step_names: Vec<&str> = job["steps"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|step| step["name"].as_str())
        .collect();
    let start = step_names
        .iter()
        .position(|name| *name == "Start sccache server")
        .expect("test job must start the sccache server explicitly");
    let configure = step_names
        .iter()
        .position(|name| *name == "Configure Namespace remote sccache")
        .unwrap();
    let run = step_names
        .iter()
        .position(|name| *name == "run tests")
        .unwrap();
    assert!(configure < start && start < run, "{step_names:?}");
}
