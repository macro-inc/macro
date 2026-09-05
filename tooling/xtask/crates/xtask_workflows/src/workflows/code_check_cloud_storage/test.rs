use super::*;

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
