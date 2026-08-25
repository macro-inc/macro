use super::*;

#[test]
fn package_selection_does_not_pass_lib() {
    let script = include_str!("../scripts/run_tests.sh");
    assert!(
        script.contains(r#"cargo nextest run "${selected[@]}" "${pkg_args[@]}""#),
        "the -p path must use the unconstrained selected flags, not --lib: {script}"
    );
    assert!(
        !script.contains(r#"cargo nextest run "${workspace[@]}" "${pkg_args[@]}""#),
        "--lib --bins --tests with -p fails for bin-only xtask crates"
    );
}

#[test]
fn all_branch_also_tests_sync_service() {
    let script = include_str!("../scripts/run_tests.sh");
    let all_idx = script
        .find(r#"cargo nextest run --workspace --exclude sync_service "${workspace[@]}""#)
        .expect("all branch must still exclude sync_service from --all-features");
    let all_block = &script[all_idx..];
    let exit = all_block
        .find("exit 0")
        .expect("all branch must exit after the workspace run");
    assert!(
        all_block[..exit].contains(r#"cargo nextest run "${sync_service[@]}""#),
        "all branch must run sync_service without --all-features, not only the selection path"
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
