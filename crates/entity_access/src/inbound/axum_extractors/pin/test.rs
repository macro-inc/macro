use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
    routing::post,
};
use macro_authorization::{
    BOT_SCOPE_HEADER, BOT_TOKEN_HEADER, INTERNAL_API_KEY_HEADER, INTERNAL_MACRO_USER_ID_HEADER,
};
use serde::Deserialize;
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PinBody {
    pin_type: String,
    pin_index: i32,
}

type ViewExtractor = PinAccessLevelExtractor<
    ViewAccessLevel,
    FakeEntityAccessService,
    PinBody,
    FakeAuthorizationService,
>;

async fn handler(access: ViewExtractor) -> String {
    let auth = match access.entity_access_receipt.auth() {
        EntityAccessAuth::Authenticated(_) => "authenticated",
        EntityAccessAuth::Unauthenticated => "unauthenticated",
        EntityAccessAuth::Internal => "internal",
        EntityAccessAuth::Bot(_) => "bot",
    };

    format!(
        "{auth}:{}:{}:{}",
        access.pin_type.pin_type, access.inner.pin_type, access.inner.pin_index
    )
}

fn router(state: TestState) -> Router {
    Router::new()
        .route("/pins/{pinned_item_id}", post(handler))
        .with_state(state)
}

fn request() -> axum::http::request::Builder {
    Request::post(format!("/pins/{ITEM_ID}")).header(header::CONTENT_TYPE, "application/json")
}

fn body() -> Body {
    Body::from(r#"{"pinType":"document","pinIndex":7}"#)
}

async fn response_body(response: axum::response::Response) -> String {
    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("response body should be readable");
    String::from_utf8(body.to_vec()).expect("response body should be UTF-8")
}

#[tokio::test]
async fn authenticated_pin_access_uses_user_acl_and_preserves_body() {
    let state = TestState::new(Some(AccessLevel::View));
    let response = router(state.clone())
        .oneshot(
            request()
                .header(header::AUTHORIZATION, "Bearer valid")
                .body(body())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response_body(response).await,
        "authenticated:document:document:7"
    );
    assert_eq!(
        state.entity_access.calls(),
        [AccessCall {
            user_id: Some(USER_ID.to_string()),
            entity_id: ITEM_ID.to_string(),
            entity_type: EntityType::Document,
        }]
    );
}

#[tokio::test]
async fn anonymous_pin_access_is_rejected_before_acl_lookup() {
    let state = TestState::new(Some(AccessLevel::View));
    let response = router(state.clone())
        .oneshot(request().body(body()).unwrap())
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert!(state.entity_access.calls().is_empty());
}

#[tokio::test]
async fn identity_less_internal_pin_access_is_rejected_without_acl_lookup() {
    let state = TestState::new(Some(AccessLevel::View));
    let response = router(state.clone())
        .oneshot(
            request()
                .header(INTERNAL_API_KEY_HEADER, INTERNAL_KEY)
                .body(body())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert!(state.entity_access.calls().is_empty());
}

#[tokio::test]
async fn internal_pin_act_as_identity_uses_acl() {
    let state = TestState::new(Some(AccessLevel::View));
    let response = router(state.clone())
        .oneshot(
            request()
                .header(INTERNAL_API_KEY_HEADER, INTERNAL_KEY)
                .header(INTERNAL_MACRO_USER_ID_HEADER, USER_ID)
                .body(body())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response_body(response).await,
        "authenticated:document:document:7"
    );
    assert_eq!(
        state.entity_access.calls()[0].user_id.as_deref(),
        Some(USER_ID)
    );
}

#[tokio::test]
async fn bot_pin_access_is_forbidden_before_acl_lookup() {
    let state = TestState::new(Some(AccessLevel::Owner));
    let response = router(state.clone())
        .oneshot(
            request()
                .header(BOT_TOKEN_HEADER, VALID_BOT_TOKEN)
                .header(BOT_SCOPE_HEADER, "user")
                .body(body())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert_eq!(response_body(response).await, r#"{"message":"forbidden"}"#);
    assert!(state.entity_access.calls().is_empty());
}

#[tokio::test]
async fn expired_pin_credentials_preserve_authorization_rejection() {
    let state = TestState::new(Some(AccessLevel::Owner));
    let response = router(state.clone())
        .oneshot(
            request()
                .header(header::AUTHORIZATION, "Bearer expired")
                .body(body())
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
