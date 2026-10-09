use super::*;

#[test]
fn inventory_only_changes_run_live_config_validation() {
    let with = serde_json::to_value(&paths_filter().value.with).unwrap();
    let filters = with["filters"].as_str().unwrap().to_owned();
    let doppler_filter = filters
        .split("doppler_candidates:")
        .nth(1)
        .expect("doppler gate filter");
    assert!(doppler_filter.contains(".github/services-config.json"));
    let job = serde_json::to_value(doppler_config()).unwrap();
    let condition = job["if"].as_str().unwrap();
    assert!(!condition.contains("rust_packages"), "{condition}");
    assert!(
        condition.contains("doppler_candidates == 'true'"),
        "{condition}"
    );
}

/// Every trigger `xtask doppler-bins` checks must open the gate, or a config
/// change could skip live validation.
#[test]
fn doppler_gate_covers_the_bin_triggers() {
    let filters = serde_json::to_string(&paths_filter().value.with).unwrap();
    for glob in [
        "**/src/config.rs",
        "**/src/doppler_config.rs",
        "**/Cargo.toml",
    ] {
        assert!(filters.contains(glob), "missing {glob}: {filters}");
    }
}

/// path-check stays compile-free on a warm cache: the Doppler bins moved to
/// their own job, and validation no longer rides on clippy.
#[test]
fn doppler_work_is_off_path_check_and_check() {
    for job in [path_check(), check()] {
        let job = serde_json::to_string(&job).unwrap();
        assert!(!job.contains("doppler-bins"), "{job}");
        assert!(!job.contains("validate Doppler configs"), "{job}");
    }
    let job = serde_json::to_string(&doppler_config()).unwrap();
    assert!(job.contains("doppler-bins") && job.contains("validate Doppler configs"));
    assert!(job.contains("steps.doppler-bins.outputs.doppler_config_bins"));
}

/// The shared binary cache is only mounted for same-repo PRs.
#[test]
fn filter_binary_cache_is_trusted_only() {
    let job = serde_json::to_value(path_check()).unwrap();
    let mount = job["steps"]
        .as_array()
        .unwrap()
        .iter()
        .find(|step| step["name"] == "Mount nextest-filter binary cache")
        .expect("binary cache mount");
    let condition = mount["if"].as_str().unwrap();
    assert!(
        condition.contains("github.event.pull_request.head.repo.full_name == github.repository"),
        "{condition}"
    );
}

/// The required status check fails when any job it gathers failed, including
/// the new Doppler job.
#[test]
fn status_check_covers_every_job() {
    let status = serde_json::to_value(status_check()).unwrap();
    let script = status["steps"][0]["run"].as_str().unwrap();
    for needed in ["path-check", "check", "doppler-config", "test"] {
        let check = format!(r#"[[ "${{{{ needs.{needed}.result }}}}" == "failure" ]]"#);
        assert!(script.contains(&check), "{check}: {script}");
        assert!(
            status["needs"]
                .as_array()
                .unwrap()
                .contains(&serde_json::json!(needed))
        );
    }
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

/// The `if … fi` block starting at `marker` in the filter script.
fn filter_script_block(marker: &str) -> &'static str {
    let script = include_str!("../scripts/compute_nextest_filter.sh");
    let start = script
        .find(marker)
        .unwrap_or_else(|| panic!("{marker} must remain"));
    let end = script[start..].find("\nfi\n").unwrap() + start;
    &script[start..end]
}

#[test]
fn sqlx_only_clippies_and_skips_live_tests() {
    let sqlx_block = filter_script_block("if ! grep -qvE '^\\.sqlx/'");
    assert!(
        sqlx_block.contains("emit all true"),
        "sqlx-only must clippy all and skip the live-Postgres suite: {sqlx_block}"
    );
    assert!(
        !sqlx_block.contains("emit none"),
        "sqlx-only must not skip clippy: {sqlx_block}"
    );
}

/// Every exit goes through `emit`, so both outputs are always written once.
#[test]
fn every_exit_goes_through_emit() {
    let script = include_str!("../scripts/compute_nextest_filter.sh");
    let body = &script[script.find("emit() {").expect("emit must remain")..];
    let emit = &body[..body.find("\n}\n").unwrap()];
    assert!(
        emit.contains("rust_packages=$1") && emit.contains("skip_tests=$2"),
        "{emit}"
    );
    let after_emit = &body[body.find("\n}\n").unwrap()..];
    assert!(
        !after_emit.contains(">> \"$GITHUB_OUTPUT\""),
        "outputs must only be written by emit: {after_emit}"
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

/// Root Cargo.toml edits are classified by `xtask nextest-filter` (members and
/// workspace dependencies scope through the graph diff); only toolchain and
/// cargo config still short-circuit to the full suite in bash.
#[test]
fn root_manifest_is_classified_by_the_filter_not_forced_all() {
    let script = include_str!("../scripts/compute_nextest_filter.sh");
    let force_all = script
        .lines()
        .find(|line| line.contains(r"grep -qE '^(rust-toolchain"))
        .expect("toolchain changes must still force the full suite");
    for path in [
        "Cargo\\.toml",
        "Cross\\.toml",
        "deny\\.toml",
        "clippy\\.toml",
    ] {
        assert!(
            !force_all.contains(path),
            "{path} must not force the full suite: {force_all}"
        );
    }
    assert!(force_all.contains(r"\.cargo/"));
}

/// A clippy.toml edit re-lints everything but only skips tests when no
/// package was selected for other reasons.
#[test]
fn clippy_config_only_change_skips_tests() {
    let block = filter_script_block(r#"if [ "$clippy_config_changed" = true ]; then"#);
    assert!(block.contains("emit all true"), "{block}");
    assert!(block.contains("emit all false"), "{block}");
}

/// Stacked PRs can get a merge commit whose first parent is another branch;
/// the changed-files step deepens history before giving up on a merge-base.
#[test]
fn missing_merge_base_deepens_before_falling_back() {
    let script = include_str!("../scripts/compute_changed_files.sh");
    let deepen = script.find("--deepen").expect("must deepen the PR history");
    let fallback = script
        .find("falling back to full test suite")
        .expect("must keep the full-suite fallback");
    assert!(deepen < fallback);
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
