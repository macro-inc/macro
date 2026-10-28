use super::*;
use crate::domain::model::{CreateAgentSessionParams, ReplicaId, SandboxSize};
use crate::domain::ports::{
    AgentSessionRepo, NoOpAgentSessionNameGenerator, NoOpRealtime, NoOpTurnObserver,
    NoopLifecyclePublisher,
};
use crate::domain::service::AgentSessionServiceImpl;
use crate::testing::InMemoryAgentSessionRepo;
async fn view_router() -> Router {
    view_router_with_log(Vec::new()).await
}
async fn view_router_with_log(log: Vec<crate::domain::model::AgentSessionLog>) -> Router {
    let repo = InMemoryAgentSessionRepo::new();
    repo.extend_log(log);
    repo.create(CreateAgentSessionParams {
        purpose: crate::domain::model::SessionPurpose::Standalone,
        repo_branch: None,
        id: AgentSessionId::TEST_A,
        owner_id: Owner::User(MacroUserIdStr::try_from(OWNER.to_owned()).unwrap()),
        bot_id: BotId::TEST_A,
        thread_id: None,
        originating_message_id: None,
        model: "codex".into(),
        harness: "codex-cloud".into(),
        repo_url: None,
        workspace: String::new(),
        sandbox_size: SandboxSize::Default,
        instructions: None,
        mcp_servers: Default::default(),
        egress_token_hash: None,
    })
    .await
    .unwrap();
    let auth = MacroAuthorizationServiceImpl::new(
        FakeJwtValidator,
        InternalAuthConfig {
            api_key: "test-internal-key".into(),
            default_user_id: None,
        },
        SelfBotAuthorizer,
        NoUserApiKeyAuthorizer,
    );
    agent_session_read_router(AgentSessionRouterState::new(
        AgentSessionServiceImpl::new(
            repo.clone(),
            agent_fold::domain::service::FoldedMessageService::new(repo),
            NoOpRealtime,
            NoOpAgentSessionNameGenerator,
            Arc::new(NoOpTurnObserver),
            Arc::new(NoopLifecyclePublisher),
            ReplicaId::mint(),
        ),
        Arc::new(entity_access::domain::ports::NoOpEntityAccessService),
        MacroAuthorizationState::new(Arc::new(auth)),
    ))
}
#[tokio::test]
async fn invalid_credentials_cannot_read_saved_session() {
    let response = view_router()
        .await
        .oneshot(
            Request::builder()
                .uri(format!("/{}", AgentSessionId::TEST_A))
                .header(BOT_TOKEN_HEADER, "invalid-token")
                .header(BOT_SCOPE_HEADER, "user")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}
#[tokio::test]
async fn detached_session_returns_saved_metadata() {
    let response = view_router()
        .await
        .oneshot(
            Request::builder()
                .uri(format!("/{}", AgentSessionId::TEST_A))
                .header(
                    macro_authorization::INTERNAL_API_KEY_HEADER,
                    "test-internal-key",
                )
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = axum::body::to_bytes(response.into_body(), 8192)
        .await
        .unwrap();
    let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(value["id"], AgentSessionId::TEST_A.to_string());
}
#[tokio::test]
async fn folded_log_serves_the_folded_conversation() {
    let recorded =
        agent_fold::testing::parse_log_as(AgentSessionId::TEST_A, agent_fold::testing::TURN);
    let expected = agent_fold::domain::fold::fold(recorded.clone());
    let response = view_router_with_log(recorded)
        .await
        .oneshot(
            Request::builder()
                .uri(format!("/{}/log/folded", AgentSessionId::TEST_A))
                .header(
                    macro_authorization::INTERNAL_API_KEY_HEADER,
                    "test-internal-key",
                )
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let expected = serde_json::to_value(
        expected
            .into_iter()
            .map(|message| {
                agent_fold::inbound::wire::FoldedMessage::new(AgentSessionId::TEST_A, message)
            })
            .collect::<Vec<_>>(),
    )
    .unwrap();
    assert_eq!(body["messages"], expected);
    assert!(!body["messages"].as_array().unwrap().is_empty());
    assert!(body["bot"]["name"].is_string());
}
