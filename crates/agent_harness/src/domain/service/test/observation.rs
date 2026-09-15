use super::*;
use agent_session::domain::ports::{SessionObserver, SessionOwnership};
use entity_access::domain::models::{
    AccessLevel, Entity, EntityAccessReceipt, EntityPermission, EntityType, ViewAccessLevel,
};

fn receipt(id: AgentSessionId) -> EntityAccessReceipt<ViewAccessLevel> {
    EntityAccessReceipt::try_new_authenticated_user(
        sender(),
        Entity {
            entity_id: id.to_string(),
            entity_type: EntityType::AgentSession,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::View,
        },
    )
    .unwrap()
}
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
            kind: AgentKind::SandboxedCoder,
            size: SandboxSize::Default,
            egress: None,
        })
        .await
        .unwrap();
    id
}

#[tokio::test]
async fn codex_view_resumes_once_without_prompt_or_new_session() {
    let (service, repo, containers, _, _) = harness();
    let id = codex_session(&repo, &containers).await;
    service.observe(&receipt(id)).await.unwrap();
    let container = containers.container(id).unwrap();
    let agent = container.agent();
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        container.sends_ready();
        agent.wait_for_requests(1).await;
        agent.completes_initialize(
            InitializeResponse::new(PROTOCOL_VERSION)
                .agent_capabilities(AgentCapabilities::new().load_session(true)),
        );
        agent.wait_for_requests(2).await;
        assert!(matches!(
            &agent.received_requests()[1],
            ClientRequest::LoadSessionRequest(_)
        ));
        agent.loads_session(agent_client_protocol::schema::v1::LoadSessionResponse::new());
    })
    .await
    .unwrap();
    service.observe(&receipt(id)).await.unwrap();
    assert_eq!(containers.resumed(), 1);
    assert_eq!(
        containers.spawned(),
        1,
        "observation never spawns a new container"
    );
    assert!(prompts(&agent).is_empty());
}

#[tokio::test]
async fn codex_view_does_not_take_over_peer_management() {
    let (service, repo, containers, _, _) = harness();
    let id = codex_session(&repo, &containers).await;
    let replica = ReplicaId::mint();
    repo.claim(id, replica).await.unwrap();
    let before = repo.manager_of(id).await.unwrap().unwrap();
    service.observe(&receipt(id)).await.unwrap();
    let after = repo.manager_of(id).await.unwrap().unwrap();
    assert_eq!(before.replica, after.replica);
    assert_eq!(containers.resumed(), 0);
}

#[tokio::test]
async fn view_never_resumes_paid_sandboxes_and_rejects_foreign_receipts() {
    let (service, repo, containers, _, _) = harness();
    let id = disconnected_session(&repo, &containers).await;
    service.observe(&receipt(id)).await.unwrap();
    assert_eq!(containers.resumed(), 0);
    let foreign = EntityAccessReceipt::try_new_authenticated_user(
        sender(),
        Entity {
            entity_id: id.to_string(),
            entity_type: EntityType::Document,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::View,
        },
    )
    .unwrap();
    assert!(matches!(
        service.observe(&foreign).await,
        Err(AgentSessionError::Forbidden)
    ));
}

#[tokio::test]
async fn cancelled_observation_waiter_does_not_cancel_queued_attachment() {
    let (service, repo, containers, _, _) = harness();
    let id = codex_session(&repo, &containers).await;
    // Admission is synchronous; dropping the HTTP completion waiter must not undo it.
    let completion = service.execute(id, HarnessCommand::Observe);
    drop(completion);
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        while containers.resumed() == 0 {
            tokio::task::yield_now().await;
        }
        while repo.manager_of(id).await.unwrap().is_none() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert_eq!(containers.resumed(), 1);
    assert!(prompts(&containers.container(id).unwrap().agent()).is_empty());
}
