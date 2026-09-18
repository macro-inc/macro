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
        should_run.contains("crates/agent_fold/**"),
        "fold wasm source must rebuild the web artifact: {should_run}"
    );
    assert!(
        should_run.contains("crates/agent_runtime_protocol/**"),
        "fold wasm path dep must rebuild the web artifact: {should_run}"
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
    assert!(
        build.contains(".wasm-pack"),
        "build must persist wasm-pack's wasm-opt cache: {build}"
    );
    assert!(
        build.contains("just build-dev"),
        "build still produces the vite bundle: {build}"
    );
}
