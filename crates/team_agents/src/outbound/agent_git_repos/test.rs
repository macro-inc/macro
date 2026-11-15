use super::*;

fn agent() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|ada-1@example.com".to_owned()).unwrap()
}

#[test]
fn the_clone_url_is_the_agents_repo_under_the_base() {
    let base = AgentGitServiceUrl::from_static("https://dev-gateway.macro.com/agent-git");
    assert_eq!(
        clone_url(&base, &agent()).unwrap(),
        format!(
            "https://dev-gateway.macro.com/agent-git/{}.git",
            agent().as_ref()
        )
    );
}

#[test]
fn a_loopback_or_credentialed_base_is_refused() {
    for base in [
        "http://localhost:8111",
        "http://127.0.0.1:8111",
        "https://user:pass@git.example.com",
        "https://git.example.com/?token=1",
    ] {
        assert!(
            clone_url(&AgentGitServiceUrl::from_static(base), &agent()).is_err(),
            "{base} must be refused"
        );
    }
}
