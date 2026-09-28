use super::*;

fn rendered_yaml() -> String {
    sdk_check()
        .to_string()
        .expect("SDK check workflow should serialize")
}

/// Merges to `main` publish, so the package suite has to guard them too — but
/// the expensive spec rebuild stays on pull requests.
#[test]
fn checks_the_package_on_main_and_regenerates_only_on_pull_requests() {
    let yaml = rendered_yaml();

    assert!(yaml.contains("check-package"));
    assert!(yaml.contains("push:"));
    assert!(yaml.contains("${{ github.event_name == 'pull_request' }}"));
}

#[test]
fn the_package_job_needs_no_rust_toolchain() {
    let yaml = rendered_yaml();
    let package_job = yaml
        .split("check-sdk:")
        .next()
        .expect("check-package is rendered before check-sdk");

    assert!(package_job.contains("bun install --frozen-lockfile"));
    assert!(!package_job.contains("setup-nix"));
    assert!(!package_job.contains("sccache"));
}
