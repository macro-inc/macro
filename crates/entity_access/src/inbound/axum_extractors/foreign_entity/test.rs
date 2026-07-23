use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
    routing::get,
};
use macro_authorization::{BOT_SCOPE_HEADER, BOT_TOKEN_HEADER};
use tower::ServiceExt;

use super::*;
use crate::{
    domain::models::{AccessLevel, ViewAccessLevel},
    inbound::axum_extractors::test_support::{
        FakeAuthorizationService, FakeEntityAccessService, TestState, VALID_BOT_TOKEN,
    },
};

const FOREIGN_ENTITY_ID: &str = "550e8400-e29b-41d4-a716-446655440000";

type ViewExtractor = ForeignEntityAccessLevelExtractor<
    ViewAccessLevel,
    FakeEntityAccessService,
    FakeAuthorizationService,
>;

async fn handler(_access: ViewExtractor) -> StatusCode {
    StatusCode::OK
}

#[tokio::test]
async fn bot_credentials_are_forbidden_without_permission_lookup() {
    let state = TestState::new(Some(AccessLevel::Owner));
    let router = Router::new()
        .route("/foreign/{foreign_entity_id}", get(handler))
        .with_state(state.clone());
    let request = Request::get(format!("/foreign/{FOREIGN_ENTITY_ID}"))
        .header(BOT_TOKEN_HEADER, VALID_BOT_TOKEN)
        .header(BOT_SCOPE_HEADER, "user")
        .body(Body::empty())
        .expect("request should be valid");

    let response = router
        .oneshot(request)
        .await
        .expect("request should complete");

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("response body should be readable");
    assert_eq!(body.as_ref(), br#"{"message":"forbidden"}"#);
    assert!(state.entity_access.calls().is_empty());
}
