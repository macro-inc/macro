use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
    routing::get,
};
use macro_authorization::{BOT_SCOPE_HEADER, BOT_TOKEN_HEADER, BotScope, INTERNAL_API_KEY_HEADER};
use macro_user_id::user_id::MacroUserIdStr;
use tower::ServiceExt;

use super::*;
use crate::{
    domain::models::{
        AccessLevel, BotAccessScope, CommentAccessLevel, EntityAccessAuth, ViewAccessLevel,
    },
    inbound::axum_extractors::test_support::{
        BOT_ACTING_USER_ID, BOT_ACTING_USER_ORGANIZATION_ID, BOT_ID, BOT_TEAM_ID, BotAccessCall,
        FakeAuthorizationService, FakeEntityAccessService, INTERNAL_KEY,
        MALFORMED_SYSTEM_BOT_TOKEN, TestState, VALID_BOT_TOKEN,
    },
};

const USER_SCOPE_FOREIGN_ENTITY_ID: &str = "550e8400-e29b-41d4-a716-446655440000";
const TEAM_PAIR_FOREIGN_ENTITY_ID: &str = "550e8400-e29b-41d4-a716-446655440001";
const BOT_PRINCIPAL_FOREIGN_ENTITY_ID: &str = "550e8400-e29b-41d4-a716-446655440002";
const UNRELATED_FOREIGN_ENTITY_ID: &str = "550e8400-e29b-41d4-a716-446655440003";

type ViewExtractor = ForeignEntityAccessLevelExtractor<
    ViewAccessLevel,
    FakeEntityAccessService,
    FakeAuthorizationService,
>;
type CommentExtractor = ForeignEntityAccessLevelExtractor<
    CommentAccessLevel,
    FakeEntityAccessService,
    FakeAuthorizationService,
>;

async fn view_handler(access: ViewExtractor) -> &'static str {
    match access.entity_access_receipt.auth() {
        EntityAccessAuth::Bot(_) => "bot",
        EntityAccessAuth::Internal => "internal",
        EntityAccessAuth::Authenticated(_) => "user",
        EntityAccessAuth::Unauthenticated => "anonymous",
    }
}

async fn comment_handler(_access: CommentExtractor) -> StatusCode {
    StatusCode::OK
}

fn router(state: TestState) -> Router {
    Router::new()
        .route("/foreign/{foreign_entity_id}", get(view_handler))
        .route("/foreign-comment/{id}", get(comment_handler))
        .with_state(state)
}

fn bot_request(path: &str, scope: BotScope, token: &str) -> Request<Body> {
    Request::get(path)
        .header(BOT_TOKEN_HEADER, token)
        .header(BOT_SCOPE_HEADER, scope.as_str())
        .body(Body::empty())
        .expect("bot request should be valid")
}

async fn send(router: Router, request: Request<Body>) -> (StatusCode, String) {
    let response = router
        .oneshot(request)
        .await
        .expect("request should complete");
    let status = response.status();
    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("response body should be readable");

    (
        status,
        String::from_utf8(body.to_vec()).expect("response body should be UTF-8"),
    )
}

#[tokio::test]
async fn user_scoped_bot_uses_acting_user_scope_and_retains_bot_auth() {
    let state = TestState::new(Some(AccessLevel::View));
    let request = bot_request(
        &format!("/foreign/{USER_SCOPE_FOREIGN_ENTITY_ID}"),
        BotScope::User,
        VALID_BOT_TOKEN,
    );

    let (status, body) = send(router(state.clone()), request).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, "bot");
    assert_eq!(
        state.entity_access.bot_calls(),
        [BotAccessCall {
            bot_id: BOT_ID,
            scope: BotAccessScope::User {
                user_id: MacroUserIdStr::parse_from_str(BOT_ACTING_USER_ID)
                    .expect("acting user ID should be valid"),
                user_org_id: Some(i64::from(BOT_ACTING_USER_ORGANIZATION_ID)),
            },
            entity_id: USER_SCOPE_FOREIGN_ENTITY_ID.to_string(),
            entity_type: EntityType::ForeignEntity,
        }]
    );
    assert!(state.entity_access.calls().is_empty());
}

#[tokio::test]
async fn team_scoped_bot_accepts_team_pair_access() {
    assert_team_scoped_access(TEAM_PAIR_FOREIGN_ENTITY_ID).await;
}

#[tokio::test]
async fn team_scoped_bot_accepts_direct_bot_principal_access() {
    assert_team_scoped_access(BOT_PRINCIPAL_FOREIGN_ENTITY_ID).await;
}

async fn assert_team_scoped_access(foreign_entity_id: &str) {
    let state = TestState::new(Some(AccessLevel::View));
    let request = bot_request(
        &format!("/foreign/{foreign_entity_id}"),
        BotScope::Team,
        VALID_BOT_TOKEN,
    );

    let (status, body) = send(router(state.clone()), request).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, "bot");
    assert_eq!(
        state.entity_access.bot_calls(),
        [BotAccessCall {
            bot_id: BOT_ID,
            scope: BotAccessScope::Team {
                team_id: BOT_TEAM_ID,
            },
            entity_id: foreign_entity_id.to_string(),
            entity_type: EntityType::ForeignEntity,
        }]
    );
}

#[tokio::test]
async fn team_scoped_bot_propagates_unrelated_source_denial() {
    let state = TestState::new(None);
    let request = bot_request(
        &format!("/foreign/{UNRELATED_FOREIGN_ENTITY_ID}"),
        BotScope::Team,
        VALID_BOT_TOKEN,
    );

    let (status, _body) = send(router(state.clone()), request).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(
        state.entity_access.bot_calls(),
        [BotAccessCall {
            bot_id: BOT_ID,
            scope: BotAccessScope::Team {
                team_id: BOT_TEAM_ID,
            },
            entity_id: UNRELATED_FOREIGN_ENTITY_ID.to_string(),
            entity_type: EntityType::ForeignEntity,
        }]
    );
}

#[tokio::test]
async fn user_scoped_bot_without_acting_user_is_unauthorized() {
    let state = TestState::new(Some(AccessLevel::View));
    let request = bot_request(
        &format!("/foreign/{USER_SCOPE_FOREIGN_ENTITY_ID}"),
        BotScope::User,
        MALFORMED_SYSTEM_BOT_TOKEN,
    );

    let (status, body) = send(router(state.clone()), request).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(
        body,
        r#"{"message":"bot user scope requires an acting user"}"#
    );
    assert!(state.entity_access.bot_calls().is_empty());
}

#[tokio::test]
async fn malformed_foreign_entity_id_is_rejected_before_access_lookup() {
    let state = TestState::new(Some(AccessLevel::View));
    let request = bot_request("/foreign/not-a-uuid", BotScope::Team, VALID_BOT_TOKEN);

    let (status, body) = send(router(state.clone()), request).await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        body,
        r#"{"message":"Bad request: invalid foreign entity ID format"}"#
    );
    assert!(state.entity_access.bot_calls().is_empty());
}

#[tokio::test]
async fn foreign_entity_access_satisfies_only_view_level_requirements() {
    let view_state = TestState::new(Some(AccessLevel::View));
    let view_request = bot_request(
        &format!("/foreign/{TEAM_PAIR_FOREIGN_ENTITY_ID}"),
        BotScope::Team,
        VALID_BOT_TOKEN,
    );
    let (view_status, _) = send(router(view_state), view_request).await;
    assert_eq!(view_status, StatusCode::OK);

    let comment_state = TestState::new(Some(AccessLevel::View));
    let comment_request = bot_request(
        &format!("/foreign-comment/{TEAM_PAIR_FOREIGN_ENTITY_ID}"),
        BotScope::Team,
        VALID_BOT_TOKEN,
    );
    let (comment_status, _) = send(router(comment_state.clone()), comment_request).await;

    assert_eq!(comment_status, StatusCode::UNAUTHORIZED);
    assert_eq!(comment_state.entity_access.bot_calls().len(), 1);
}

#[tokio::test]
async fn anonymous_requests_are_rejected_without_access_lookup() {
    let state = TestState::new(Some(AccessLevel::View));
    let request = Request::get(format!("/foreign/{USER_SCOPE_FOREIGN_ENTITY_ID}"))
        .body(Body::empty())
        .expect("anonymous request should be valid");

    let (status, _) = send(router(state.clone()), request).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert!(state.entity_access.calls().is_empty());
    assert!(state.entity_access.bot_calls().is_empty());
}

#[tokio::test]
async fn identity_less_internal_request_receives_view_without_access_lookup() {
    let state = TestState::new(None);
    let request = Request::get(format!("/foreign/{USER_SCOPE_FOREIGN_ENTITY_ID}"))
        .header(INTERNAL_API_KEY_HEADER, INTERNAL_KEY)
        .body(Body::empty())
        .expect("internal request should be valid");

    let (status, body) = send(router(state.clone()), request).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, "internal");
    assert!(state.entity_access.calls().is_empty());
    assert!(state.entity_access.bot_calls().is_empty());
}
