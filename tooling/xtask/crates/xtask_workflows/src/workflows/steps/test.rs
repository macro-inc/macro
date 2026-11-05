use super::*;

#[test]
fn namespace_sccache_masks_credentials_before_exporting_them() {
    let step = configure_namespace_sccache("test-cache");
    let condition = step
        .value
        .if_condition
        .as_ref()
        .expect("Namespace sccache credentials should be limited to trusted refs");
    let run = step
        .value
        .run
        .expect("Namespace sccache setup should be a run step");

    let mask = run
        .find("echo \"::add-mask::$v\"")
        .expect("credential values should be registered with GitHub's log masker");
    let export = run
        .find("cat \"$env_file\" >> \"$GITHUB_ENV\"")
        .expect("the generated sccache environment should be exported");

    assert!(mask < export, "credentials must be masked before export");
    assert!(run.contains("*TOKEN*|*SECRET*|*PASSWORD*"));
    assert!(run.contains("mktemp \"$RUNNER_TEMP/namespace-sccache.XXXXXX\""));
    assert!(run.contains("trap 'rm -f \"$env_file\"' EXIT"));
    assert!(run.contains("nsc cache sccache setup --cache_name test-cache"));
    assert!(
        condition
            .0
            .contains("github.event.pull_request.head.repo.full_name")
    );
    assert!(condition.0.contains("github.repository"));
}

#[test]
fn named_dev_shell_passes_the_flake_attribute() {
    let step = setup_dev_shell_named("agent-daemon");
    let with = step.value.with.expect("named shell should set with.shell");
    assert_eq!(
        with.0.get("shell").and_then(|value| value.as_str()),
        Some("agent-daemon")
    );
}

#[test]
fn default_dev_shell_does_not_pass_a_shell_input() {
    let step = setup_dev_shell();
    assert!(
        step.value.with.is_none(),
        "unspecified shell must keep the action default so other workflows stay unchanged"
    );
}

#[test]
fn web_build_cache_volume_includes_wasm_pack_and_cargo() {
    let step = mount_web_build_cache_volume();
    let with = step.value.with.expect("cache volume should set paths");
    let path = with
        .0
        .get("path")
        .and_then(|value| value.as_str())
        .expect("path list");
    assert!(path.contains("/home/runner/.bun/install/cache"));
    assert!(path.contains("/home/runner/.cargo/registry"));
    assert!(path.contains("/home/runner/.cargo/git"));
    assert!(path.contains("/home/runner/.cache/.wasm-pack"));
    assert_eq!(
        with.0.get("cache").and_then(|value| value.as_str()),
        Some("nix")
    );
}

#[test]
fn namespace_sccache_allows_a_slow_backend_check_at_startup() {
    let run = configure_namespace_sccache("test-cache")
        .value
        .run
        .expect("Namespace sccache setup should be a run step");

    let write = run
        .find("echo 'server_startup_timeout_ms = 60000' > \"$sccache_conf\"")
        .expect("the startup limit should be written to a config file");
    let export = run
        .find("echo \"SCCACHE_CONF=$sccache_conf\" >> \"$GITHUB_ENV\"")
        .expect("later steps should read the config file");
    let stop = run
        .find("sccache --stop-server")
        .expect("the server should restart with the new backend");

    assert!(write < export && export < stop);
}

/// Only a job that has run `bun install` may generate from it. Rust jobs have no
/// `node_modules`, so they keep building the assets in Nix.
#[test]
fn only_the_install_variant_generates_code_mode_assets_from_dependencies() {
    let flag = "CODE_MODE_ASSETS_FROM_INSTALL";
    let with_flag = serde_json::to_string(&code_mode_assets_from_install()).expect("step json");
    let without_flag = serde_json::to_string(&code_mode_assets()).expect("step json");
    assert_eq!(
        with_flag.matches(flag).count(),
        without_flag.matches(flag).count() + 1,
        "only the variant sets {flag}"
    );
}
