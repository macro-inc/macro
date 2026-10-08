use super::*;
use crate::domain::model::ReplicaId;
use crate::domain::ports::{
    NoOpAgentSessionNameGenerator, NoOpRealtime, NoOpTurnObserver, NoopLifecyclePublisher,
};
use crate::domain::service::AgentSessionServiceImpl;
use crate::testing::InMemoryAgentSessionRepo;

fn task_tracking_router() -> Router {
    let repo = InMemoryAgentSessionRepo::new();
    let auth = MacroAuthorizationServiceImpl::new(
        FakeJwtValidator,
        InternalAuthConfig {
            api_key: "test-internal-key".into(),
            default_user_id: None,
        },
        SelfBotAuthorizer,
        NoUserApiKeyAuthorizer,
    );
    agent_task_tracking_router(AgentSessionRouterState::new(
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

async fn json_body(response: Response) -> serde_json::Value {
    let body = axum::body::to_bytes(response.into_body(), 8192)
        .await
        .unwrap();
    serde_json::from_slice(&body).unwrap()
}

#[tokio::test]
async fn task_tracking_is_off_until_the_caller_enables_it() {
    let router = task_tracking_router();

    let read = router
        .clone()
        .oneshot(
            Request::get("/agent-task-tracking")
                .header(header::AUTHORIZATION, format!("Bearer {OWNER}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(read.status(), StatusCode::OK);
    assert_eq!(
        json_body(read).await,
        serde_json::json!({ "enabled": false })
    );

    let write = router
        .clone()
        .oneshot(
            Request::put("/agent-task-tracking")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::AUTHORIZATION, format!("Bearer {OWNER}"))
                .body(Body::from(r#"{"enabled":true}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(write.status(), StatusCode::OK);
    assert_eq!(
        json_body(write).await,
        serde_json::json!({ "enabled": true })
    );

    let reread = router
        .clone()
        .oneshot(
            Request::get("/agent-task-tracking")
                .header(header::AUTHORIZATION, format!("Bearer {OWNER}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        json_body(reread).await,
        serde_json::json!({ "enabled": true })
    );

    let other_user = router
        .oneshot(
            Request::get("/agent-task-tracking")
                .header(
                    header::AUTHORIZATION,
                    "Bearer macro|someone-else@example.com",
                )
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        json_body(other_user).await,
        serde_json::json!({ "enabled": false })
    );
}

#[tokio::test]
async fn task_tracking_requires_a_user() {
    let response = task_tracking_router()
        .oneshot(
            Request::get("/agent-task-tracking")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}
