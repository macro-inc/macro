use super::*;

fn rendered_yaml() -> String {
    build_agent_daemon_on_tag()
        .to_string()
        .expect("daemon workflow should serialize")
}

#[test]
fn linux_jobs_enter_the_agent_daemon_shell() {
    let yaml = rendered_yaml();
    assert!(
        yaml.contains("shell: agent-daemon"),
        "Linux jobs must enter devShells.agent-daemon, got:\n{yaml}"
    );
    assert!(
        yaml.matches("shell: agent-daemon").count() >= 2,
        "both Linux targets should request the agent-daemon shell"
    );
}

#[test]
fn linux_jobs_wire_the_s3_nix_cache() {
    let yaml = rendered_yaml();
    assert!(
        yaml.contains("nix-cache-url: ${{ vars.NIX_CACHE_URL }}"),
        "Linux jobs should substitute from the private nix cache"
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
        .expect("publish-daemon needs an if so a failed platform does not skip the release");
    assert!(if_line.contains("!cancelled()"));
    assert!(if_line.contains("needs.resolve-ref.result"));
    for slug in [
        "linux-x86-64",
        "linux-aarch64",
        "macos-aarch64",
        "macos-x86-64",
    ] {
        let needle = format!("needs.build-daemon-{slug}.result");
        assert!(
            if_line.contains(&needle),
            "publish if missing {needle}: {if_line}"
        );
    }
}
