use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
    routing::post,
};
use macro_authorization::{
    BOT_SCOPE_HEADER, BOT_TOKEN_HEADER, BotScope, INTERNAL_API_KEY_HEADER,
    INTERNAL_MACRO_USER_ID_HEADER,
};
use macro_user_id::user_id::MacroUserIdStr;
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

type ViewExtractor =
    HistoryAccessExtractor<ViewAccessLevel, FakeEntityAccessService, FakeAuthorizationService>;
type EditExtractor =
    HistoryAccessExtractor<EditAccessLevel, FakeEntityAccessService, FakeAuthorizationService>;

async fn view_handler(access: ViewExtractor) -> &'static str {
    receipt_auth_name(access.entity_access_receipt.auth())
}

async fn edit_handler(access: EditExtractor) -> &'static str {
    receipt_auth_name(access.entity_access_receipt.auth())
}

fn receipt_auth_name(auth: &EntityAccessAuth) -> &'static str {
    match auth {
        EntityAccessAuth::Authenticated(_) => "authenticated",
        EntityAccessAuth::Unauthenticated => "unauthenticated",
        EntityAccessAuth::Internal => "internal",
        EntityAccessAuth::Bot(_) => "bot",
    }
}

fn view_router(state: TestState) -> Router {
    Router::new()
        .route("/history/{item_type}/{item_id}", post(view_handler))
        .with_state(state)
}

fn edit_router(state: TestState) -> Router {
    Router::new()
        .route("/history/{item_type}/{item_id}", post(edit_handler))
        .with_state(state)
}

fn request() -> axum::http::request::Builder {
    request_for("document")
}

fn request_for(item_type: &str) -> axum::http::request::Builder {
    Request::post(format!("/history/{item_type}/{ITEM_ID}"))
}

fn bot_request(item_type: &str, scope: BotScope, token: &str) -> Request<Body> {
    request_for(item_type)
        .header(BOT_TOKEN_HEADER, token)
        .header(BOT_SCOPE_HEADER, scope.as_str())
        .body(Body::empty())
        .expect("bot request should be valid")
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
    let response = view_router(state.clone())
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
    assert!(state.entity_access.bot_calls().is_empty());
}

#[tokio::test]
async fn identity_less_internal_history_access_receives_owner_without_acl_lookup() {
    let state = TestState::new(None);
    let response = view_router(state.clone())
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
    assert!(state.entity_access.bot_calls().is_empty());
}

#[tokio::test]
async fn internal_history_act_as_identity_uses_acl() {
    let state = TestState::new(Some(AccessLevel::View));
    let response = view_router(state.clone())
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
    assert!(state.entity_access.bot_calls().is_empty());
}

#[tokio::test]
async fn user_scoped_bot_uses_the_acting_user_scope() {
    let state = TestState::new(Some(AccessLevel::View));
    let response = view_router(state.clone())
        .oneshot(bot_request("document", BotScope::User, VALID_BOT_TOKEN))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response_body(response).await, "bot");
    assert_eq!(
        state.entity_access.bot_calls(),
        [BotAccessCall {
            bot_id: BOT_ID,
            scope: BotAccessScope::User {
                user_id: MacroUserIdStr::parse_from_str(BOT_ACTING_USER_ID)
                    .expect("acting user ID should be valid"),
                user_org_id: Some(i64::from(BOT_ACTING_USER_ORGANIZATION_ID)),
            },
            entity_id: ITEM_ID.to_string(),
            entity_type: EntityType::Document,
        }]
    );
    assert!(state.entity_access.calls().is_empty());
}

#[tokio::test]
async fn team_scoped_bot_uses_the_owning_team_scope() {
    let state = TestState::new(Some(AccessLevel::View));
    let response = view_router(state.clone())
        .oneshot(bot_request("document", BotScope::Team, VALID_BOT_TOKEN))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response_body(response).await, "bot");
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
    let state = TestState::new(Some(AccessLevel::View));
    let response = view_router(state.clone())
        .oneshot(bot_request(
            "document",
            BotScope::User,
            MALFORMED_SYSTEM_BOT_TOKEN,
        ))
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
async fn malformed_item_type_is_rejected_before_bot_acl_lookup() {
    let state = TestState::new(Some(AccessLevel::View));
    let response = view_router(state.clone())
        .oneshot(bot_request(
            "not-an-entity-type",
            BotScope::Team,
            VALID_BOT_TOKEN,
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response_body(response).await,
        r#"{"message":"Bad request: Invalid item_type"}"#
    );
    assert!(state.entity_access.bot_calls().is_empty());
    assert!(state.entity_access.calls().is_empty());
}

#[tokio::test]
async fn unsupported_bot_entity_type_preserves_the_service_rejection() {
    let state = TestState::new(None);
    let response = view_router(state.clone())
        .oneshot(bot_request("user", BotScope::Team, VALID_BOT_TOKEN))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response_body(response).await,
        r#"{"message":"Bad request: Unsupported bot entity type"}"#
    );
    assert_eq!(
        state.entity_access.bot_calls(),
        [BotAccessCall {
            bot_id: BOT_ID,
            scope: BotAccessScope::Team {
                team_id: BOT_TEAM_ID,
            },
            entity_id: ITEM_ID.to_string(),
            entity_type: EntityType::User,
        }]
    );
    assert!(state.entity_access.calls().is_empty());
}

#[tokio::test]
async fn bot_with_insufficient_permission_is_rejected() {
    let state = TestState::new(Some(AccessLevel::View));
    let response = edit_router(state.clone())
        .oneshot(bot_request("document", BotScope::Team, VALID_BOT_TOKEN))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(state.entity_access.bot_calls().len(), 1);
    assert!(state.entity_access.calls().is_empty());
}

#[tokio::test]
async fn expired_history_credentials_preserve_authorization_rejection() {
    let state = TestState::new(Some(AccessLevel::Owner));
    let response = view_router(state.clone())
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
    assert!(state.entity_access.bot_calls().is_empty());
}
