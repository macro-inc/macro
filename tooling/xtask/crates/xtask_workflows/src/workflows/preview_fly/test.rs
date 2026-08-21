use super::*;

fn rendered() -> String {
    preview_fly()
        .to_string()
        .expect("workflow should serialize")
}

#[test]
fn deploy_does_not_need_ghcr_packages() {
    let yaml = rendered();
    assert!(
        !yaml.contains("packages: read"),
        "preview builds the sandbox image locally: {yaml}"
    );
}

#[test]
fn both_image_loops_include_the_sandbox_tag() {
    let yaml = rendered();
    let tag = vars::AGENT_HARNESS_LOCAL_IMAGE;
    assert!(
        yaml.contains(&format!("LOCAL_SANDBOX_IMAGE: {tag}")),
        "sandbox tag should be injected as step env: {yaml}"
    );
    assert!(
        yaml.contains("alpine:3 \"$LOCAL_SANDBOX_IMAGE\""),
        "premirror loop should append the sandbox tag: {yaml}"
    );
    assert!(
        yaml.contains("$images alpine:3 \"$LOCAL_SANDBOX_IMAGE\""),
        "deploy loop should append the sandbox tag: {yaml}"
    );
}

#[test]
fn images_lane_always_builds_the_sandbox_image() {
    let yaml = rendered();
    assert!(
        yaml.contains("docker build --tag \"$LOCAL_SANDBOX_IMAGE\" crates/agent_harness/container"),
        "{yaml}"
    );
    assert!(
        !yaml.contains("PREVIEW_BASE_SHA"),
        "git-diff vs base is unnecessary when we always build: {yaml}"
    );
    assert!(
        !yaml.contains("SANDBOX_GHCR_IMAGE"),
        "preview should not pull GHCR: {yaml}"
    );
}
