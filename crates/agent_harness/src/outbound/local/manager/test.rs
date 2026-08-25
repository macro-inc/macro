use super::*;
use crate::outbound::daytona::{AnthropicApiKey, GithubToken};

/// One container per session, so a resume finds exactly one and `docker ps`
/// says which session it belongs to.
#[test]
fn a_session_names_one_container() {
    let session = AgentSessionId::TEST_A;

    assert_eq!(container_name(session), format!("macro-agent-{session}"));
}

/// On a shared network the sidecar keeps its own port and the container name
/// is its DNS name.
#[test]
fn a_sidecar_is_dialed_by_container_name() {
    assert_eq!(
        sidecar_address(&ContainerRef {
            name: "macro-agent-abc".to_owned(),
        }),
        format!("macro-agent-abc:{}", provision::SIDECAR_PORT)
    );
}

/// Same credentials Daytona injects, so the readiness recipe is exercised
/// against the same environment a deployed sandbox sees. The Anthropic key
/// is what activates the one model provider `container/opencode.json`
/// enables.
#[test]
fn sandbox_env_carries_the_repo_and_credentials() {
    let env = sandbox_env(
        "https://github.com/macro-inc/macro".to_owned(),
        &GithubToken::new("test-token".to_owned()),
        &AnthropicApiKey::new("test-anthropic-key".to_owned()),
    );

    assert!(env.contains(&(
        "REPO_URL".to_owned(),
        "https://github.com/macro-inc/macro".to_owned()
    )));
    assert!(env.contains(&("GITHUB_TOKEN".to_owned(), "test-token".to_owned())));
    assert!(env.contains(&(
        "ANTHROPIC_API_KEY".to_owned(),
        "test-anthropic-key".to_owned()
    )));
}
