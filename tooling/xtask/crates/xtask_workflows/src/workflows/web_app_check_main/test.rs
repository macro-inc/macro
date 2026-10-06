use super::*;

fn filters(yaml: &str) -> (&str, &str) {
    let filters = yaml
        .split("filters: |")
        .nth(1)
        .and_then(|rest| rest.split("id: filter").next())
        .expect("path-check filters");
    filters
        .split_once("codegen_changed:")
        .expect("should_run block, then codegen_changed block")
}

/// A job's rendered YAML, from its id up to the next job's id. Slicing by id
/// keeps the job's `needs:` and `if:`, which render before its `name:`.
fn job<'a>(yaml: &'a str, id: &str, next_id: &str) -> &'a str {
    yaml.split(&format!("\n  {id}:\n"))
        .nth(1)
        .and_then(|rest| rest.split(&format!("\n  {next_id}:\n")).next())
        .unwrap_or_else(|| panic!("{id} job"))
}

#[test]
fn nix_dev_shell_does_not_start_typecheck() {
    let yaml = web_app_check_main().to_string().expect("workflow yaml");
    let (should_run, _) = filters(&yaml);
    assert!(
        !should_run.contains("setup-nix-dev-shell"),
        "Typecheck runs on should_run; nix-dev-shell must not be in it: {should_run}"
    );
    assert!(
        should_run.contains("setup-reqs-web"),
        "web setup action still belongs in should_run: {should_run}"
    );
}

#[test]
fn typecheck_runs_lexical_service_check_and_tests() {
    let yaml = web_app_check_main().to_string().expect("workflow yaml");
    let typescript = job(&yaml, "typescript", "generated-code");
    assert!(
        typescript.contains("bun run check"),
        "Typecheck must type-check lexical-service: {typescript}"
    );
    assert!(
        typescript.contains("bun test src"),
        "Typecheck must run lexical-service endpoint tests: {typescript}"
    );
    assert!(
        typescript.contains("services/lexical-service"),
        "lexical-service steps must run in the service directory: {typescript}"
    );
}

#[test]
fn typecheck_compiles_no_rust() {
    let yaml = web_app_check_main().to_string().expect("workflow yaml");
    let typescript = job(&yaml, "typescript", "generated-code");
    for rust in ["gen-api", "cargo", "sccache", "just gen-"] {
        assert!(
            !typescript.contains(rust),
            "generated code is checked in its own job, so Typecheck must not run `{rust}`: {typescript}"
        );
    }
    assert!(
        typescript.contains("should_run == 'true'") && !typescript.contains("codegen_changed"),
        "a Rust-only change does not start Typecheck: {typescript}"
    );
}

/// The OpenAPI clients, specta types, SDK and docs tool pages all come from
/// workspace binaries, so one job builds them once and checks all four.
#[test]
fn generated_code_checks_every_rust_generated_artifact_in_one_job() {
    let yaml = web_app_check_main().to_string().expect("workflow yaml");
    let generated = job(&yaml, "generated-code", "biome-check");
    // Specta runs last: its `cargo run -p` builds resolve features per
    // package and would otherwise make the docs build recompile.
    let order = [
        "Build schema binaries",
        "bun run gen-api -- --check",
        "bun run sync-specs",
        "git status --porcelain -- packages/sdk",
        "bun run generate:tools",
        "git status --porcelain -- apps/docs",
        "just gen-agent-fold-types",
        "just gen-database-sql-types",
    ];
    let positions: Vec<usize> = order
        .iter()
        .map(|needle| {
            generated
                .find(needle)
                .unwrap_or_else(|| panic!("missing `{needle}`: {generated}"))
        })
        .collect();
    assert!(
        positions.windows(2).all(|pair| pair[0] < pair[1]),
        "the binaries build first, then each artifact is checked: {generated}"
    );
    let sdk = generated
        .split("name: Regenerate SDK code")
        .nth(1)
        .and_then(|rest| rest.split("- name:").next())
        .expect("SDK regeneration step");
    assert!(
        !sdk.contains("gen-api") && !sdk.contains("update-generated"),
        "the SDK reuses the specs gen-api wrote instead of rerunning it: {sdk}"
    );
    assert!(
        generated.contains("nsc cache sccache setup --cache_name web-ci"),
        "the build uses the shared web-ci remote sccache: {generated}"
    );
}

/// Debug info only slows the throwaway generator build. Set at job level so
/// every cargo call in the job shares the profile and reuses one build.
#[test]
fn generated_code_builds_without_debug_info_for_every_step() {
    let yaml = web_app_check_main().to_string().expect("workflow yaml");
    let generated = job(&yaml, "generated-code", "biome-check");
    let (header, steps) = generated
        .split_once("\n    steps:\n")
        .expect("job header, then steps");
    assert!(
        header.contains("CARGO_PROFILE_DEV_DEBUG: '0'"),
        "the job env turns debug info off: {header}"
    );
    assert!(
        header.contains("RUSTFLAGS: '-C link-arg=-fuse-ld=mold'"),
        "the job links with mold like the Rust jobs: {header}"
    );
    for flag in ["CARGO_PROFILE_DEV_DEBUG", "RUSTFLAGS", "--config"] {
        assert!(
            !steps.contains(flag),
            "no step may override `{flag}`, or its build stops reusing the others: {steps}"
        );
    }
}

#[test]
fn codegen_filter_covers_every_input_of_the_generated_code_job() {
    let yaml = web_app_check_main().to_string().expect("workflow yaml");
    let (_, codegen) = filters(&yaml);
    for path in [
        "'crates/**/*.rs'",
        "'services/**/*.rs'",
        "'Cargo.toml'",
        "'Cargo.lock'",
        "'apps/web/scripts/generate-api-schema.ts'",
        "'apps/web/scripts/services.ts'",
        "'packages/sdk/**'",
        "'apps/docs/**'",
    ] {
        assert!(
            codegen.contains(path),
            "codegen_changed must include {path}: {codegen}"
        );
    }
    let generated = job(&yaml, "generated-code", "biome-check");
    assert!(generated.contains("needs.path-check.outputs.codegen_changed == 'true'"));
}

#[test]
fn status_check_requires_generated_code() {
    let yaml = web_app_check_main().to_string().expect("workflow yaml");
    let status = yaml
        .split("\n  status-check:\n")
        .nth(1)
        .expect("status check job");
    assert!(status.contains("- generated-code"), "{status}");
    assert!(
        status.contains("needs.generated-code.result }}\" == \"failure\""),
        "{status}"
    );
}

#[test]
fn should_run_includes_fold_wasm_inputs() {
    let yaml = web_app_check_main().to_string().expect("workflow yaml");
    let filters = yaml
        .split("filters: |")
        .nth(1)
        .and_then(|rest| rest.split("id: filter").next())
        .expect("path-check filters");
    let should_run = filters
        .split("api_changed:")
        .next()
        .expect("should_run block");
    assert!(
        should_run.contains("crates/folds/agent_fold/**"),
        "fold wasm source must rebuild the web artifact: {should_run}"
    );
    assert!(
        should_run.contains("crates/agent_runtime_protocol/**"),
        "fold wasm path dep must rebuild the web artifact: {should_run}"
    );
    assert!(
        should_run.contains("crates/database_sql/**"),
        "SQL engine wasm source must rebuild the web artifact: {should_run}"
    );
}

#[test]
fn build_job_uses_remote_sccache_and_wasm_cache() {
    let yaml = web_app_check_main().to_string().expect("workflow yaml");
    let build = yaml
        .split("\n  build:\n")
        .nth(1)
        .and_then(|rest| rest.split("\n  status-check:").next())
        .expect("build job");
    assert!(
        build.contains("namespace-profile-linux-mid"),
        "wasm compile needs the mid runner: {build}"
    );
    assert!(
        build.contains("nsc cache sccache setup --cache_name web-ci"),
        "build must use the shared web-ci remote sccache: {build}"
    );
    let configure = build
        .find("nsc cache sccache setup")
        .expect("remote cache configuration");
    let start = build
        .find("run: sccache --start-server")
        .expect("start the server in a separate step with the exported credentials");
    let build_command = build.find("just build-").expect("web build command");
    assert!(configure < start && start < build_command);
    assert!(
        build.contains(".wasm-pack"),
        "build must persist wasm-pack's wasm-opt cache: {build}"
    );
    assert!(
        build.contains("just build-dev"),
        "build still produces the vite bundle: {build}"
    );
}

#[test]
fn test_job_runs_signup_browser_tests_after_vitest() {
    let yaml = web_app_check_main().to_string().expect("workflow yaml");
    // The job and its vitest step are both named "Test"; slice from the job.
    let start = yaml.find("name: Test\n").expect("Test job");
    let end = yaml[start..]
        .find("name: Cycles Import Check")
        .map_or(yaml.len(), |offset| start + offset);
    let test_job = &yaml[start..end];
    let vitest = test_job.find("bunx vitest").expect("vitest step");
    let browser = test_job
        .find("just test-signup-browser")
        .expect("sign-up browser step");
    assert!(
        vitest < browser,
        "browser tests run after vitest: {test_job}"
    );
    assert!(
        test_job.contains("playwright: 'true'"),
        "the Test job installs Playwright's Chromium: {test_job}"
    );
}
