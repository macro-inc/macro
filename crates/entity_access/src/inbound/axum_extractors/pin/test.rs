use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
    routing::post,
};
use macro_authorization::{
    BOT_SCOPE_HEADER, BOT_TOKEN_HEADER, INTERNAL_API_KEY_HEADER, INTERNAL_MACRO_USER_ID_HEADER,
};
use macro_user_id::user_id::MacroUserIdStr;
use serde::Deserialize;
use tower::ServiceExt;

use super::*;
use crate::{
    domain::models::{
        AccessLevel, BotAccessScope, EditAccessLevel, EntityAccessAuth, EntityType, ViewAccessLevel,
    },
    inbound::axum_extractors::test_support::{
        AccessCall, BOT_ACTING_USER_ID, BOT_ACTING_USER_ORGANIZATION_ID, BOT_ID, BOT_TEAM_ID,
        BotAccessCall, FakeAuthorizationService, FakeEntityAccessService, INTERNAL_KEY,
        MALFORMED_SYSTEM_BOT_TOKEN, TestState, USER_ID, VALID_BOT_TOKEN,
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
type EditExtractor = PinAccessLevelExtractor<
    EditAccessLevel,
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
    body_with_pin_type("document")
}

fn body_with_pin_type(pin_type: &str) -> Body {
    Body::from(format!(r#"{{"pinType":"{pin_type}","pinIndex":7}}"#))
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
async fn user_scoped_bot_uses_scoped_access_and_preserves_the_typed_body() {
    let state = TestState::new(Some(AccessLevel::View));
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

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response_body(response).await, "bot:document:document:7");
    assert_eq!(
        state.entity_access.bot_calls(),
        [BotAccessCall {
            bot_id: BOT_ID,
            scope: BotAccessScope::User {
                user_id: MacroUserIdStr::parse_from_str(BOT_ACTING_USER_ID)
                    .expect("bot acting user id should be valid"),
                user_org_id: Some(i64::from(BOT_ACTING_USER_ORGANIZATION_ID)),
            },
            entity_id: ITEM_ID.to_string(),
            entity_type: EntityType::Document,
        }]
    );
    assert!(state.entity_access.calls().is_empty());
}

#[tokio::test]
async fn team_scoped_bot_uses_scoped_access() {
    let state = TestState::new(Some(AccessLevel::View));
    let response = router(state.clone())
        .oneshot(
            request()
                .header(BOT_TOKEN_HEADER, VALID_BOT_TOKEN)
                .header(BOT_SCOPE_HEADER, "team")
                .body(body())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response_body(response).await, "bot:document:document:7");
    assert_eq!(
        state.entity_access.bot_calls(),
        [BotAccessCall {
            bot_id: BOT_ID,
            scope: BotAccessScope::Team {
                team_id: BOT_TEAM_ID,
            },
            entity_id: ITEM_ID.to_string(),
            entity_type: EntityType::Document,
        }]
    );
    assert!(state.entity_access.calls().is_empty());
}

#[tokio::test]
async fn user_scoped_bot_without_an_acting_user_is_rejected() {
    let state = TestState::new(Some(AccessLevel::Owner));
    let response = router(state.clone())
        .oneshot(
            request()
                .header(BOT_TOKEN_HEADER, MALFORMED_SYSTEM_BOT_TOKEN)
                .header(BOT_SCOPE_HEADER, "user")
                .body(body())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        response_body(response).await,
        r#"{"message":"bot user scope requires an acting user"}"#
    );
    assert!(state.entity_access.bot_calls().is_empty());
    assert!(state.entity_access.calls().is_empty());
}

#[tokio::test]
async fn bot_with_insufficient_access_is_rejected() {
    async fn edit_handler(_access: EditExtractor) {}

    let state = TestState::new(Some(AccessLevel::View));
    let router = Router::new()
        .route("/pins/{pinned_item_id}", post(edit_handler))
        .with_state(state.clone());
    let response = router
        .oneshot(
            request()
                .header(BOT_TOKEN_HEADER, VALID_BOT_TOKEN)
                .header(BOT_SCOPE_HEADER, "team")
                .body(body())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(state.entity_access.bot_calls().len(), 1);
    assert!(state.entity_access.calls().is_empty());
}

#[tokio::test]
async fn malformed_or_missing_pin_type_is_rejected_before_bot_acl_lookup() {
    for body in [
        Body::from(r#"{"pinIndex":7}"#),
        Body::from(r#"{"pinType":7,"pinIndex":7}"#),
    ] {
        let state = TestState::new(Some(AccessLevel::Owner));
        let response = router(state.clone())
            .oneshot(
                request()
                    .header(BOT_TOKEN_HEADER, VALID_BOT_TOKEN)
                    .header(BOT_SCOPE_HEADER, "team")
                    .body(body)
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert_eq!(
            response_body(response).await,
            r#"{"message":"Bad request: body is missing pinType"}"#
        );
        assert!(state.entity_access.bot_calls().is_empty());
    }
}

#[tokio::test]
async fn unknown_pin_type_is_rejected_before_bot_acl_lookup() {
    let state = TestState::new(Some(AccessLevel::Owner));
    let response = router(state.clone())
        .oneshot(
            request()
                .header(BOT_TOKEN_HEADER, VALID_BOT_TOKEN)
                .header(BOT_SCOPE_HEADER, "team")
                .body(body_with_pin_type("unsupported"))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response_body(response).await,
        r#"{"message":"Bad request: Invalid pin_type"}"#
    );
    assert!(state.entity_access.bot_calls().is_empty());
}

#[tokio::test]
async fn unsupported_bot_entity_type_preserves_the_service_rejection() {
    let state = TestState::new(Some(AccessLevel::Owner));
    let response = router(state.clone())
        .oneshot(
            request()
                .header(BOT_TOKEN_HEADER, VALID_BOT_TOKEN)
                .header(BOT_SCOPE_HEADER, "team")
                .body(body_with_pin_type("user"))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response_body(response).await,
        r#"{"message":"Bad request: Unsupported bot entity type"}"#
    );
    assert_eq!(state.entity_access.bot_calls().len(), 1);
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
