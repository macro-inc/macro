use super::*;

fn rendered_yaml() -> String {
    build_agent_daemon_on_tag()
        .to_string()
        .expect("daemon workflow should serialize")
}

#[test]
fn linux_jobs_enter_the_agent_daemon_shell() {
    let yaml = rendered_yaml();
    assert_eq!(
        yaml.matches("shell: agent-daemon").count(),
        LINUX_TARGETS.len(),
        "every Linux target should request the agent-daemon shell"
    );
}

#[test]
fn linux_jobs_wire_the_s3_nix_cache() {
    let yaml = rendered_yaml();
    assert_eq!(
        yaml.matches("nix-cache-url: ${{ vars.NIX_CACHE_URL }}")
            .count(),
        LINUX_TARGETS.len()
    );
}

#[test]
fn publish_runs_when_any_platform_succeeds() {
    let yaml = rendered_yaml();
    let publish = yaml
        .split("\n  publish-daemon:\n")
        .nth(1)
        .expect("publish-daemon job");
    let if_line = publish
        .lines()
        .find(|line| line.trim_start().starts_with("if:"))
        .expect("publish-daemon should tolerate individual platform failures");
    assert!(if_line.contains("!cancelled()"));
    assert!(if_line.contains("needs.resolve-ref.result"));
    assert!(if_line.contains(" || "));
    assert!(!if_line.contains(" && needs.build-daemon"));
    for target in LINUX_TARGETS.iter().chain(MACOS_TARGETS) {
        assert!(if_line.contains(&format!("needs.{}.result == ''success''", job_id(target))));
    }
}
