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
        .find(|step| step["name"] == "Mount nextest-filter and cargo registry cache")
        .expect("binary cache mount");
    let condition = mount["if"].as_str().unwrap();
    assert!(
        condition.contains("github.event.pull_request.head.repo.full_name == github.repository"),
        "{condition}"
    );
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

/// --all-features hides soup helpers that only the service or the Postgres
/// repository call; most dependents build soup without `outbound`.
#[test]
fn clippy_lints_soup_without_outbound_whenever_soup_is_linted() {
    let script = include_str!("../scripts/cargo_clippy.sh");
    assert!(script.contains("cargo clippy -p soup --no-default-features\n"));
    assert!(script.contains("cargo clippy -p soup --no-default-features --features ports"));
    let calls = script.matches("\n  clippy_soup_without_outbound\n").count();
    assert_eq!(
        calls, 2,
        "both the full run and a targeted soup run lint it: {script}"
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
fn test_job_builds_workspace_crates_without_debug_info() {
    let job = serde_json::to_value(test()).unwrap();
    assert_eq!(job["env"]["CARGO_PROFILE_DEV_DEBUG"], "0");
    assert_eq!(job["env"]["CARGO_PROFILE_TEST_DEBUG"], "0");
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

/// A schema change runs the compatibility check against the base branch tip.
#[test]
fn schema_changes_run_the_compatibility_check() {
    let filters = serde_json::to_value(&paths_filter().value.with).unwrap()["filters"]
        .as_str()
        .unwrap()
        .to_owned();
    let schema_filter = filters
        .split("graphql_schema:")
        .nth(1)
        .expect("graphql schema filter");
    assert!(schema_filter.contains("static_assets/schema.graphql"));
    let job = serde_json::to_value(graphql_schema_compat()).unwrap();
    assert!(
        job["if"]
            .as_str()
            .unwrap()
            .contains("graphql_schema == 'true'")
    );
    let job = job.to_string();
    assert!(job.contains("graphql-schema-compat --base HEAD^1"), "{job}");
}

/// A stalled step must not hold a runner for the default six hours, and the dev
/// shell, where stalls have happened, must fail well before the job limit.
#[test]
fn rust_jobs_have_timeouts() {
    for job in [
        path_check(),
        check(),
        doppler_config(),
        graphql_schema_compat(),
        test(),
    ] {
        let job = serde_json::to_value(job).unwrap();
        assert!(job["timeout-minutes"].is_u64(), "{job}");
    }
    for job in [check(), doppler_config(), test()] {
        let job = serde_json::to_value(job).unwrap();
        let shell = job["steps"]
            .as_array()
            .unwrap()
            .iter()
            .find(|step| step["name"] == "Setup Nix dev shell")
            .expect("dev shell step");
        assert_eq!(shell["timeout-minutes"], vars::DEV_SHELL_TIMEOUT_MINUTES);
    }
}

/// Plain `cargo test` here rebuilt hundreds of crates under different flags to run
/// about four seconds of tests.
#[test]
fn deno_tests_reuse_the_test_run_build() {
    let deno_step = serde_json::to_value(test_execution_runtime()).unwrap();
    let test_step = serde_json::to_value(run_tests()).unwrap();
    assert_eq!(deno_step["run"], test_step["run"]);
    assert_eq!(deno_step["env"]["NEXTEST_RUN_DENO_TESTS"], "true");
}

/// Per-test database creation is the bulk of the test run's time, and the
/// settings `configure_postgres` applies only survive its restart on a bind mount.
#[test]
fn test_postgres_keeps_its_data_in_shared_memory_across_a_restart() {
    let service = serde_json::to_value(postgres_service()).unwrap();
    let options = service["options"].as_str().unwrap();
    assert!(
        options.contains("-v /dev/shm/pgdata:/var/lib/postgresql/data"),
        "{options}"
    );
    assert!(!options.contains("--tmpfs"), "{options}");
}

/// The gate may run the job with nothing to build, but it must never hide a
/// service the script builds, or a real-build failure in it passes the PR.
#[test]
fn service_bins_gate_covers_every_service_the_script_builds() {
    let script = include_str!("../scripts/build_service_bins.sh");
    let services = script
        .split("for service in ")
        .nth(1)
        .and_then(|rest| rest.split("; do").next())
        .expect("service list");

    for service in services.split_whitespace() {
        assert!(
            BUILD_SERVICE_BINS_CONDITION.contains(&format!("'{service}'")),
            "{service} is built by the script but missing from the job's gate"
        );
    }
}

/// The jobs that compile the workspace date the checkout for the `target` they
/// keep, and rebuild everything when the pull request changes query data:
/// `CARGO_TARGET_REBUILD_ALL` reads path-check's output, which reads the
/// filter that lists `.sqlx` paths.
#[test]
fn compiling_jobs_rebuild_everything_when_query_data_changes() {
    let workflow = serde_json::to_value(code_check_cloud_storage()).unwrap();
    for id in ["check", "test", "build-service-bins", "doppler-config"] {
        let job = &workflow["jobs"][id];
        let reason = job["env"]["CARGO_TARGET_REBUILD_ALL"]
            .as_str()
            .unwrap_or_default();
        assert!(
            reason.contains("needs.path-check.outputs.query_data == 'true'"),
            "{id}: {reason}"
        );
        let names: Vec<&str> = job["steps"]
            .as_array()
            .unwrap()
            .iter()
            .map(|step| step["name"].as_str().unwrap_or_default())
            .collect();
        assert!(
            names.contains(&"Reuse the kept cargo target"),
            "{id} reuses its target: {names:?}"
        );
    }

    assert_eq!(
        workflow["jobs"]["path-check"]["outputs"]["query_data"].as_str(),
        Some("${{ steps.filter.outputs.query_data }}")
    );
    let with = serde_json::to_value(&paths_filter().value.with).unwrap();
    let filters: serde_yaml::Value =
        serde_yaml::from_str(with["filters"].as_str().unwrap()).unwrap();
    assert_eq!(
        filters["query_data"],
        serde_yaml::from_str::<serde_yaml::Value>("['**/.sqlx/**']").unwrap()
    );
}

/// The test job compiles the crates whose `.env` names the test database
/// against this run's schema, never a kept unit: those `.env` files exist only
/// after `setup_test_envs`, and the databases are migrated after the dating.
#[test]
fn test_job_rebuilds_the_crates_that_check_queries_live() {
    let run = serde_json::to_value(prepare_tests()).unwrap()["run"]
        .as_str()
        .unwrap()
        .to_owned();
    let at = |text: &str| run.find(text).unwrap_or_else(|| panic!("{text}: {run}"));
    assert!(at("just setup_test_envs") < at(DATE_LIVE_QUERY_CRATES));
    assert!(at(DATE_LIVE_QUERY_CRATES) < at("just initialize_dbs"));
}

/// [`DATE_LIVE_QUERY_CRATES`] looks for `.env` files under `crates` and
/// `services`; one `setup_test_envs` writes anywhere else would compile against
/// a kept unit.
#[test]
fn live_query_crates_are_where_the_dating_looks() {
    let just = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../just/rust.just"
    ));
    let recipe = just
        .split("\nsetup_test_envs:\n")
        .nth(1)
        .expect("setup_test_envs recipe");
    let envs: Vec<&str> = recipe
        .lines()
        .take_while(|line| line.starts_with(' '))
        .filter_map(|line| line.split(">> ./").nth(1))
        .collect();
    assert!(!envs.is_empty(), "{recipe}");
    assert!(DATE_LIVE_QUERY_CRATES.contains("find crates services -name .env"));
    for env in envs {
        assert!(
            env.ends_with("/.env") && (env.starts_with("crates/") || env.starts_with("services/")),
            "{env}"
        );
    }
}

#[test]
fn loro_guards_are_required_and_share_the_path_check_gate() {
    let job = serde_json::to_value(check()).unwrap();
    assert_eq!(job["needs"], serde_json::json!(["path-check"]));
    let steps = job["steps"].as_array().unwrap();
    let setup = steps
        .iter()
        .position(|step| step["name"] == "Configure Namespace remote sccache")
        .unwrap();
    let assets = steps
        .iter()
        .position(|step| step["name"] == "Build code-mode assets")
        .unwrap();
    for command in [
        "just check-loro-editor-vendor",
        "just check-loro-native-editor-features",
    ] {
        let matches = steps
            .iter()
            .enumerate()
            .filter(|(_, step)| step["run"] == command)
            .collect::<Vec<_>>();
        assert_eq!(matches.len(), 1, "{command}");
        let (index, step) = matches[0];
        assert!(
            setup < index && index < assets,
            "{command} must follow setup and fail before other work"
        );
        assert_eq!(step["if"], "needs.path-check.outputs.loro_guards == 'true'");
        assert_ne!(step["continue-on-error"], true);
    }
    let path_job = serde_json::to_value(path_check()).unwrap();
    assert_eq!(
        path_job["outputs"]["loro_guards"],
        "${{ steps.filter.outputs.loro_guards }}"
    );
}

#[test]
fn every_loro_guard_input_also_opens_the_existing_job_gate() {
    let with = serde_json::to_value(paths_filter().value.with).unwrap();
    let filters: serde_yaml::Value =
        serde_yaml::from_str(with["filters"].as_str().unwrap()).unwrap();
    let outer = filters["should_run"].as_sequence().unwrap();
    for path in filters["loro_guards"].as_sequence().unwrap() {
        assert!(
            outer.contains(path),
            "guard input must not be hidden by outer gate: {path:?}"
        );
    }
}

#[test]
fn rendered_guard_budget_is_thirty_minutes_only_when_requested_otherwise_twenty() {
    let rendered = crate::workflows::render_patched(code_check_cloud_storage, patch).unwrap();
    let workflow: serde_yaml::Value = serde_yaml::from_str(&rendered).unwrap();
    assert_eq!(workflow["jobs"].as_mapping().unwrap().len(), 6);
    assert_eq!(
        workflow["jobs"]["check"]["timeout-minutes"]
            .as_str()
            .unwrap(),
        "${{ needs.path-check.outputs.loro_guards == 'true' && 30 || 20 }}"
    );
    for job in [
        "test",
        "doppler-config",
        "build-service-bins",
        "graphql-schema-compat",
    ] {
        let original = serde_yaml::to_value(code_check_cloud_storage()).unwrap();
        assert_eq!(
            workflow["jobs"][job], original["jobs"][job],
            "unrelated job {job} changed"
        );
    }
}
