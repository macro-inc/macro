use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
    routing::post,
};
use macro_authorization::{
    BOT_SCOPE_HEADER, BOT_TOKEN_HEADER, INTERNAL_API_KEY_HEADER, INTERNAL_MACRO_USER_ID_HEADER,
};
use tower::ServiceExt;

use super::*;
use crate::{
    domain::models::{AccessLevel, EntityAccessAuth, EntityType, ViewAccessLevel},
    inbound::axum_extractors::test_support::{
        AccessCall, FakeAuthorizationService, FakeEntityAccessService, INTERNAL_KEY, TestState,
        USER_ID, VALID_BOT_TOKEN,
    },
};

const ITEM_ID: &str = "document-1";

type ViewExtractor =
    HistoryAccessExtractor<ViewAccessLevel, FakeEntityAccessService, FakeAuthorizationService>;

async fn handler(access: ViewExtractor) -> &'static str {
    match access.entity_access_receipt.auth() {
        EntityAccessAuth::Authenticated(_) => "authenticated",
        EntityAccessAuth::Unauthenticated => "unauthenticated",
        EntityAccessAuth::Internal => "internal",
        EntityAccessAuth::Bot(_) => "bot",
    }
}

fn router(state: TestState) -> Router {
    Router::new()
        .route("/history/{item_type}/{item_id}", post(handler))
        .with_state(state)
}

fn request() -> axum::http::request::Builder {
    Request::post(format!("/history/document/{ITEM_ID}"))
}

async fn response_body(response: axum::response::Response) -> String {
    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("response body should be readable");
    String::from_utf8(body.to_vec()).expect("response body should be UTF-8")
}

#[tokio::test]
async fn anonymous_history_access_uses_public_acl() {
    let state = TestState::new(Some(AccessLevel::View));
    let response = router(state.clone())
        .oneshot(request().body(Body::empty()).unwrap())
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response_body(response).await, "unauthenticated");
    assert_eq!(
        state.entity_access.calls(),
        [AccessCall {
            user_id: None,
            entity_id: ITEM_ID.to_string(),
            entity_type: EntityType::Document,
        }]
    );
}

#[tokio::test]
async fn identity_less_internal_history_access_receives_owner_without_acl_lookup() {
    let state = TestState::new(None);
    let response = router(state.clone())
        .oneshot(
            request()
                .header(INTERNAL_API_KEY_HEADER, INTERNAL_KEY)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response_body(response).await, "internal");
    assert!(state.entity_access.calls().is_empty());
}

#[tokio::test]
async fn internal_history_act_as_identity_uses_acl() {
    let state = TestState::new(Some(AccessLevel::View));
    let response = router(state.clone())
        .oneshot(
            request()
                .header(INTERNAL_API_KEY_HEADER, INTERNAL_KEY)
                .header(INTERNAL_MACRO_USER_ID_HEADER, USER_ID)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response_body(response).await, "authenticated");
    assert_eq!(
        state.entity_access.calls()[0].user_id.as_deref(),
        Some(USER_ID)
    );
}

#[tokio::test]
async fn bot_history_access_is_forbidden_before_acl_lookup() {
    let state = TestState::new(Some(AccessLevel::Owner));
    let response = router(state.clone())
        .oneshot(
            request()
                .header(BOT_TOKEN_HEADER, VALID_BOT_TOKEN)
                .header(BOT_SCOPE_HEADER, "user")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert_eq!(response_body(response).await, r#"{"message":"forbidden"}"#);
    assert!(state.entity_access.calls().is_empty());
}

#[tokio::test]
async fn expired_history_credentials_preserve_authorization_rejection() {
    let state = TestState::new(Some(AccessLevel::Owner));
    let response = router(state.clone())
        .oneshot(
            request()
                .header(header::AUTHORIZATION, "Bearer expired")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        response_body(response).await,
        r#"{"message":"jwt expired"}"#
    );
    assert!(state.entity_access.calls().is_empty());
}
