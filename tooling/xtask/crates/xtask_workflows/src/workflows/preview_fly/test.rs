use super::*;

fn rendered() -> String {
    preview_fly()
        .to_string()
        .expect("workflow should serialize")
}

#[test]
fn deploy_can_read_ghcr_packages() {
    let yaml = rendered();
    assert!(yaml.contains("packages: read"), "{yaml}");
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
fn images_lane_reads_token_from_env() {
    let yaml = rendered();
    assert!(yaml.contains("PREVIEW_BASE_SHA"), "{yaml}");
    assert!(
        yaml.contains("echo \"$GITHUB_TOKEN\" | docker login ghcr.io"),
        "{yaml}"
    );
    assert!(
        !yaml.contains("${{ github.token }}"),
        "token must not be interpolated into a quoted lane: {yaml}"
    );
    assert!(
        yaml.contains("github.event.pull_request.base.sha"),
        "{yaml}"
    );
}

#[test]
fn images_lane_builds_when_container_differs_from_base() {
    let yaml = rendered();
    assert!(
        yaml.contains(
            "git diff --quiet \"$PREVIEW_BASE_SHA\" HEAD -- crates/agent_harness/container"
        ),
        "{yaml}"
    );
    assert!(
        yaml.contains("docker build --tag \"$tag\" crates/agent_harness/container"),
        "{yaml}"
    );
    assert!(
        yaml.contains(&format!(
            "SANDBOX_GHCR_IMAGE: {}",
            vars::AGENT_HARNESS_GHCR_IMAGE
        )),
        "{yaml}"
    );
    assert!(
        yaml.contains("ghcr=\"$SANDBOX_GHCR_IMAGE:latest\""),
        "{yaml}"
    );
}
