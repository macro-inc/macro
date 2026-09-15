use super::*;

async fn codex_session(
    repo: &InMemoryAgentSessionRepo,
    containers: &MockContainerManager,
) -> AgentSessionId {
    let id = AgentSessionId::new();
    agent_session::domain::ports::AgentSessionRepo::create(
        repo,
        CreateAgentSessionParams {
            id,
            owner_id: sender(),
            bot_id: bot_id::CODEX_BOT_ID,
            thread_id: None,
            originating_message_id: None,
            model: "codex".into(),
            harness: "codex-cloud".into(),
            repo_url: Some("https://github.com/owner/repo".into()),
            workspace: String::new(),
            sandbox_size: SandboxSize::Default,
            instructions: None,
            mcp_servers: Default::default(),
            egress_token_hash: None,
        },
    )
    .await
    .unwrap();
    repo.set_acp_session_id(id, SessionId::new("acp-test"))
        .await
        .unwrap();
    containers
        .spawn(SpawnContainer {
            session_id: id,
            kind: AgentKind::CodexCloud,
            size: SandboxSize::Default,
            egress: crate::testing::helpers::egress::test_egress(),
        })
        .await
        .unwrap();
    id
}

#[tokio::test]
async fn codex_delivery_loads_saved_session_before_prompting() {
    let (service, repo, containers, _, _) = harness();
    let id = codex_session(&repo, &containers).await;
    let delivery = service.execute(id, HarnessCommand::Deliver(forward_message("continue")));
    let drive = async {
        while containers.resumed() == 0 {
            tokio::task::yield_now().await;
        }
        let container = containers.container(id).unwrap();
        let agent = container.agent();
        container.sends_ready();
        agent.wait_for_requests(1).await;
        agent.completes_initialize(
            InitializeResponse::new(PROTOCOL_VERSION)
                .agent_capabilities(AgentCapabilities::new().load_session(true)),
        );
        agent.wait_for_requests(2).await;
        assert!(matches!(
            &agent.received_requests()[1],
            ClientRequest::LoadSessionRequest(request) if request.session_id.to_string() == "acp-test"
        ));
        agent.loads_session(agent_client_protocol::schema::v1::LoadSessionResponse::new());
        agent.wait_for_requests(3).await;
        assert_eq!(prompts(&agent).len(), 1);
    };
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        let (result, ()) = tokio::join!(delivery, drive);
        result.unwrap();
    })
    .await
    .unwrap();
    assert_eq!(containers.resumed(), 1);
    assert_eq!(containers.spawned(), 1, "delivery reuses the saved session");
}
