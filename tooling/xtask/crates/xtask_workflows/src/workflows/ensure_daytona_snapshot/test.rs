use super::*;

fn rendered() -> String {
    ensure_daytona_snapshot()
        .to_string()
        .expect("workflow should serialize")
}

#[test]
fn workflow_can_write_packages_and_still_reads_contents() {
    let yaml = rendered();
    assert!(yaml.contains("packages: write"), "{yaml}");
    assert!(yaml.contains("contents: read"), "{yaml}");
}

#[test]
fn publish_job_pushes_multiarch_ghcr_tags() {
    let yaml = rendered();
    assert!(
        yaml.contains(
            "namespacelabs/nscloud-setup-buildx-action@d059ed7184f0bc7c8b27e8810cea153d02bcc6dd"
        ),
        "{yaml}"
    );
    assert!(
        yaml.contains(&format!("image={}", vars::AGENT_HARNESS_GHCR_IMAGE)),
        "{yaml}"
    );
    assert!(
        yaml.contains("--platform linux/amd64,linux/arm64"),
        "{yaml}"
    );
    assert!(yaml.contains(r#"--tag "$image:$GITHUB_SHA""#), "{yaml}");
    assert!(yaml.contains(r#"--tag "$image:latest""#), "{yaml}");
    assert!(yaml.contains("crates/agent_harness/container"), "{yaml}");
}

#[test]
fn login_reads_token_from_env_not_the_script_body() {
    let yaml = rendered();
    assert!(
        yaml.contains("echo \"$GITHUB_TOKEN\" | docker login ghcr.io"),
        "{yaml}"
    );
    assert!(
        !yaml.contains("${{ github.token }}"),
        "token must not be interpolated into a run script: {yaml}"
    );
}

#[test]
fn daytona_job_stays_on_the_small_runner() {
    let yaml = rendered();
    assert!(yaml.contains("namespace-profile-linux-small"), "{yaml}");
    assert!(yaml.contains("namespace-profile-linux-mid"), "{yaml}");
    assert!(yaml.contains("ensure-daytona"), "{yaml}");
}
