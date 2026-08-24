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
fn publish_job_pushes_amd64_ghcr_tags() {
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
    assert!(yaml.contains("--platform linux/amd64 \\"), "{yaml}");
    assert!(
        !yaml.contains("linux/arm64"),
        "GHCR stays amd64; local stacks bake native: {yaml}"
    );
    assert!(yaml.contains(r#"--tag "$image:$GITHUB_SHA""#), "{yaml}");
    assert!(yaml.contains(r#"tags+=(--tag "$image:latest")"#), "{yaml}");
    assert!(
        yaml.contains("refs/heads/main"),
        "latest must only be tagged on main: {yaml}"
    );
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
fn daytona_job_stays_on_the_small_runner_and_skips_prs() {
    let yaml = rendered();
    assert!(yaml.contains("namespace-profile-linux-small"), "{yaml}");
    assert!(yaml.contains("namespace-profile-linux-mid"), "{yaml}");
    assert!(yaml.contains("ensure-daytona"), "{yaml}");
    assert!(
        yaml.contains("github.event_name != 'pull_request'"),
        "{yaml}"
    );
}

#[test]
fn publish_runs_on_same_repo_pull_requests() {
    let yaml = rendered();
    assert!(yaml.contains("pull_request:"), "{yaml}");
    assert!(
        yaml.contains("github.event.pull_request.head.repo.full_name == github.repository"),
        "{yaml}"
    );
}
