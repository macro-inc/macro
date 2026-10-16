use super::*;
use crate::domain::model::ReplicaId;
use crate::domain::ports::{
    NoOpAgentSessionNameGenerator, NoOpRealtime, NoOpTurnObserver, NoopLifecyclePublisher,
};
use crate::domain::service::AgentSessionServiceImpl;
use crate::testing::InMemoryAgentSessionRepo;

fn coding_preferences_router() -> Router {
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
    agent_coding_preferences_router(AgentSessionRouterState::new(
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

async fn read(router: &Router, caller: &str) -> serde_json::Value {
    let response = router
        .clone()
        .oneshot(
            Request::get("/agent-coding-preferences")
                .header(header::AUTHORIZATION, format!("Bearer {caller}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    json_body(response).await
}

#[tokio::test]
async fn coding_preferences_are_off_until_the_caller_sets_them() {
    let router = coding_preferences_router();

    assert_eq!(
        read(&router, OWNER).await,
        serde_json::json!({ "createTasks": false, "openPullRequests": false })
    );

    let write = router
        .clone()
        .oneshot(
            Request::put("/agent-coding-preferences")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::AUTHORIZATION, format!("Bearer {OWNER}"))
                .body(Body::from(
                    r#"{"createTasks":true,"openPullRequests":false}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(write.status(), StatusCode::OK);
    assert_eq!(
        json_body(write).await,
        serde_json::json!({ "createTasks": true, "openPullRequests": false })
    );
    assert_eq!(
        read(&router, OWNER).await,
        serde_json::json!({ "createTasks": true, "openPullRequests": false })
    );

    let replace = router
        .clone()
        .oneshot(
            Request::put("/agent-coding-preferences")
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::AUTHORIZATION, format!("Bearer {OWNER}"))
                .body(Body::from(
                    r#"{"createTasks":false,"openPullRequests":true}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(replace.status(), StatusCode::OK);
    assert_eq!(
        read(&router, OWNER).await,
        serde_json::json!({ "createTasks": false, "openPullRequests": true })
    );

    assert_eq!(
        read(&router, "macro|someone-else@example.com").await,
        serde_json::json!({ "createTasks": false, "openPullRequests": false })
    );
}

#[tokio::test]
async fn coding_preferences_require_a_user() {
    let router = coding_preferences_router();

    let read = router
        .clone()
        .oneshot(
            Request::get("/agent-coding-preferences")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(read.status(), StatusCode::UNAUTHORIZED);

    let write = router
        .oneshot(
            Request::put("/agent-coding-preferences")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    r#"{"createTasks":true,"openPullRequests":true}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(write.status(), StatusCode::UNAUTHORIZED);
}
