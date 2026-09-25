use super::*;
use crate::domain::models::{EditAccessLevel, OwnerAccessLevel, ViewAccessLevel};
use crate::inbound::axum_extractors::test_support::{
    FakeAuthorizationService, FakeEntityAccessService, TestState, USER_ID,
};
use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
    routing::post,
};
use tower::ServiceExt;

async fn anonymous_request<T: RequiredPermission>(state: TestState) -> StatusCode {
    Router::new()
        .route(
            "/sessions/{session_id}",
            post(
                |access: AgentSessionAccessLevelExtractor<
                    T,
                    FakeEntityAccessService,
                    FakeAuthorizationService,
                >| async move {
                    assert!(matches!(
                        access.entity_access_receipt.auth(),
                        EntityAccessAuth::Unauthenticated
                    ));
                    assert_eq!(
                        access.entity_access_receipt.entity_permission(),
                        &EntityPermission::AccessLevel {
                            access_level: AccessLevel::View,
                        }
                    );
                    StatusCode::NO_CONTENT
                },
            ),
        )
        .with_state(state)
        .oneshot(
            Request::post("/sessions/shared-session")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap()
        .status()
}

#[tokio::test]
async fn public_sessions_allow_anonymous_views_only() {
    let public = TestState::new(Some(AccessLevel::View));
    assert_eq!(
        anonymous_request::<ViewAccessLevel>(public.clone()).await,
        StatusCode::NO_CONTENT
    );
    assert_eq!(public.entity_access.calls()[0].user_id, None);
    assert_eq!(
        anonymous_request::<ViewAccessLevel>(TestState::new(Some(AccessLevel::Edit))).await,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        anonymous_request::<ViewAccessLevel>(TestState::new(None)).await,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        anonymous_request::<EditAccessLevel>(TestState::new(Some(AccessLevel::Edit))).await,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        anonymous_request::<OwnerAccessLevel>(TestState::new(Some(AccessLevel::Owner))).await,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn permission_approval_access_accepts_editors_and_owners_but_not_viewers() {
    for (level, expected) in [
        (Some(AccessLevel::Edit), StatusCode::NO_CONTENT),
        (Some(AccessLevel::Owner), StatusCode::NO_CONTENT),
        (Some(AccessLevel::View), StatusCode::UNAUTHORIZED),
        (Some(AccessLevel::Comment), StatusCode::UNAUTHORIZED),
        (None, StatusCode::UNAUTHORIZED),
    ] {
        let state = TestState::new(level);
        let app = Router::new()
            .route(
                "/sessions/{session_id}/control",
                post(
                    |_: AgentSessionAccessLevelExtractor<
                        EditAccessLevel,
                        FakeEntityAccessService,
                        FakeAuthorizationService,
                    >| async { StatusCode::NO_CONTENT },
                ),
            )
            .with_state(state.clone());
        let response = app
            .oneshot(
                Request::post("/sessions/shared-session/control")
                    .header("authorization", "Bearer valid")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), expected, "{level:?}");
        let calls = state.entity_access.calls();
        assert_eq!(calls[0].user_id.as_deref(), Some(USER_ID));
        assert_eq!(calls[0].entity_id, "shared-session");
        assert_eq!(calls[0].entity_type, EntityType::AgentSession);
    }
}
