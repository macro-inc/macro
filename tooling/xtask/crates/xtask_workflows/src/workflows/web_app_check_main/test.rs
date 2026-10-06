use super::*;

#[test]
fn nix_dev_shell_does_not_start_typecheck() {
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
        !should_run.contains("setup-nix-dev-shell"),
        "Typecheck is should_run || api_changed; nix-dev-shell must not be in should_run: {should_run}"
    );
    assert!(
        should_run.contains("setup-reqs-web"),
        "web setup action still belongs in should_run: {should_run}"
    );
}

#[test]
fn typecheck_runs_lexical_service_check_and_tests() {
    let yaml = web_app_check_main().to_string().expect("workflow yaml");
    let typescript = yaml
        .split("name: Typecheck")
        .nth(1)
        .and_then(|rest| rest.split("name: Biome Check").next())
        .expect("Typecheck job");
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
fn typecheck_checks_both_specta_exports_when_rust_changes() {
    let yaml = web_app_check_main().to_string().expect("workflow yaml");
    let step = yaml
        .split("name: Check Specta Types")
        .nth(1)
        .and_then(|rest| rest.split("- name:").next())
        .expect("specta types step");
    assert!(
        step.contains("just gen-agent-fold-types") && step.contains("just gen-database-sql-types"),
        "both wasm crates' TypeScript must be regenerated: {step}"
    );
    assert!(
        step.contains("api_changed == 'true'"),
        "the exporters compile Rust, so only a Rust change runs them: {step}"
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
    let wasm = test_job
        .find("just build-agent-fold-wasm")
        .expect("build WASM before the test setup hook");
    let vitest = test_job.find("bunx vitest").expect("vitest step");
    assert!(wasm < vitest, "cold WASM compilation precedes Vitest");
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
