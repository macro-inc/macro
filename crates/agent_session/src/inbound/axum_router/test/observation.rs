use super::*;
use crate::domain::model::{CreateAgentSessionParams, ReplicaId, SandboxSize};
use crate::domain::ports::{
    AgentSessionRepo, NoOpAgentSessionNameGenerator, NoOpRealtime, NoOpTurnObserver,
    NoopLifecyclePublisher, SessionObserver,
};
use crate::domain::service::AgentSessionServiceImpl;
use crate::testing::InMemoryAgentSessionRepo;
use std::sync::atomic::{AtomicUsize, Ordering};

#[derive(Default)]
struct UnavailableObserver(AtomicUsize);
impl SessionObserver for UnavailableObserver {
    fn observe<'a>(
        &'a self,
        _: &'a entity_access::domain::models::EntityAccessReceipt<ViewAccessLevel>,
    ) -> std::pin::Pin<Box<dyn Future<Output = crate::domain::error::Result<()>> + Send + 'a>> {
        Box::pin(async move {
            self.0.fetch_add(1, Ordering::SeqCst);
            Err(crate::domain::error::AgentSessionError::Disconnected(
                AgentSessionId::TEST_A,
            ))
        })
    }
}
async fn view_router(observer: Arc<dyn SessionObserver>) -> Router {
    let repo = InMemoryAgentSessionRepo::new();
    repo.create(CreateAgentSessionParams {
        id: AgentSessionId::TEST_A,
        owner_id: MacroUserIdStr::try_from(OWNER.to_owned()).unwrap(),
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
    agent_session_read_router(
        AgentSessionRouterState::new(
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
        )
        .with_observer(observer),
    )
}
#[tokio::test]
async fn unauthorized_view_never_observes_provider() {
    let observer = Arc::new(UnavailableObserver::default());
    let response = view_router(observer.clone())
        .await
        .oneshot(
            Request::builder()
                .uri(format!("/{}", AgentSessionId::TEST_A))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(observer.0.load(Ordering::SeqCst), 0);
}
#[tokio::test]
async fn observation_failure_still_returns_saved_session_metadata() {
    let observer = Arc::new(UnavailableObserver::default());
    let response = view_router(observer.clone())
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
    assert_eq!(observer.0.load(Ordering::SeqCst), 1);
    let body = axum::body::to_bytes(response.into_body(), 8192)
        .await
        .unwrap();
    let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(value["id"], AgentSessionId::TEST_A.to_string());
}

struct PendingObserver;
impl SessionObserver for PendingObserver {
    fn observe<'a>(
        &'a self,
        _: &'a entity_access::domain::models::EntityAccessReceipt<ViewAccessLevel>,
    ) -> std::pin::Pin<Box<dyn Future<Output = crate::domain::error::Result<()>> + Send + 'a>> {
        Box::pin(std::future::pending())
    }
}
#[tokio::test(start_paused = true)]
async fn slow_observation_does_not_block_saved_session_metadata() {
    let response = view_router(Arc::new(PendingObserver))
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
}
