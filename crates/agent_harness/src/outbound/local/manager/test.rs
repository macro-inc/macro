use super::*;
use crate::outbound::daytona::GithubToken;

fn manager(network: Option<&str>) -> LocalContainerManager {
    LocalContainerManager::new(LocalSettings {
        docker_binary: "docker".to_owned(),
        image: "macro-agent-harness:latest".to_owned(),
        network: network.map(str::to_owned),
        github_token: GithubToken::new("test-token".to_owned()),
    })
}

/// One container per session, so a resume finds exactly one and `docker ps`
/// says which session it belongs to.
#[test]
fn a_session_names_one_container() {
    let session = AgentSessionId::TEST_A;

    assert_eq!(container_name(session), format!("macro-agent-{session}"));
}

#[test]
fn a_configured_network_is_joined_rather_than_published() {
    assert_eq!(
        manager(Some("macro_services")).reachability(),
        Reachability::Network("macro_services".to_owned())
    );
}

#[test]
fn no_network_publishes_a_host_port() {
    assert_eq!(manager(None).reachability(), Reachability::PublishedPort);
}

/// On a shared network the sidecar keeps its own port; only the published case
/// has to ask docker what the port became.
#[tokio::test]
async fn a_networked_sidecar_is_dialed_by_container_name() {
    let address = manager(Some("macro_services"))
        .sidecar_address(&ContainerRef {
            name: "macro-agent-abc".to_owned(),
        })
        .await
        .unwrap();

    assert_eq!(
        address,
        format!("macro-agent-abc:{}", provision::SIDECAR_PORT)
    );
}

/// Same clone credentials Daytona injects, so the readiness recipe is
/// exercised against the same environment a deployed sandbox sees.
#[test]
fn sandbox_env_carries_the_repo_and_github_token() {
    let env = sandbox_env(
        "https://github.com/macro-inc/macro".to_owned(),
        &GithubToken::new("test-token".to_owned()),
    );

    assert!(env.contains(&(
        "REPO_URL".to_owned(),
        "https://github.com/macro-inc/macro".to_owned()
    )));
    assert!(env.contains(&("GITHUB_TOKEN".to_owned(), "test-token".to_owned())));
}
