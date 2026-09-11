use super::*;
use crate::domain::models::EditAccessLevel;
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

#[tokio::test]
async fn permission_approval_access_accepts_editors_and_owners_but_not_viewers() {
    for (level, expected) in [
        (Some(AccessLevel::Edit), StatusCode::NO_CONTENT),
        (Some(AccessLevel::Owner), StatusCode::NO_CONTENT),
        (Some(AccessLevel::View), StatusCode::UNAUTHORIZED),
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
