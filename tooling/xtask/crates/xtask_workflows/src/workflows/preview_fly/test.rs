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
fn deploy_timeout_covers_a_cold_sandbox_image_bake() {
    let yaml = rendered();
    assert!(
        yaml.contains("timeout-minutes: 90"),
        "sandbox image bake can exceed the old 60m backstop: {yaml}"
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

#[test]
fn web_lane_raises_the_node_heap() {
    let yaml = rendered();
    assert!(
        yaml.contains("NODE_OPTIONS=--max-old-space-size=6144"),
        "vite OOM is the documented CI flap without this: {yaml}"
    );
}

#[test]
fn images_lane_builds_analytics_proxy() {
    let yaml = rendered();
    assert!(
        yaml.contains("ai_editing_worker analytics_proxy"),
        "analytics_proxy is a default compose service; omitting it makes deploy pull docker.io/library/macro-analytics_proxy: {yaml}"
    );
}

#[test]
fn deploy_mirror_skips_unpullable_local_tags() {
    let yaml = rendered();
    assert!(
        yaml.contains("mirror: skipping $img (not local, not pullable)"),
        "deploy must skip compose-built tags the way premirror already does: {yaml}"
    );
}
