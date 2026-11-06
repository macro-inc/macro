use super::*;

fn rendered_yaml() -> String {
    sdk_check()
        .to_string()
        .expect("SDK check workflow should serialize")
}

/// Merges to `main` publish, so the package suite has to guard them too.
#[test]
fn checks_the_package_in_pr_ci_and_on_main() {
    let yaml = rendered_yaml();

    assert!(yaml.contains("check-package"));
    assert!(yaml.contains("workflow_call:"));
    assert!(yaml.contains("push:"));
}

#[test]
fn the_package_job_needs_no_rust_toolchain() {
    let yaml = rendered_yaml();

    assert!(yaml.contains("bun install --frozen-lockfile"));
    assert!(!yaml.contains("setup-nix"));
    assert!(!yaml.contains("sccache"));
    assert!(
        !yaml.contains("crates/**"),
        "Rust changes reach the SDK through the web app's Generated Code Check: {yaml}"
    );
}

#[test]
fn checks_sdk_calls_after_building_the_sdk() {
    let yaml = rendered_yaml();

    assert!(yaml.contains("packages/sdk-calls/**"));
    let build = yaml.find("Build SDK").expect("SDK build");
    let check = yaml.find("Check sdk-calls").expect("sdk-calls check");
    assert!(build < check);
    assert!(yaml.contains("check:pack"));
}
