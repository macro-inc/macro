use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
    routing::get,
};
use harness_id::HarnessId;
use macro_authorization::{
    BOT_SCOPE_HEADER, BOT_TOKEN_HEADER, BotScope, HarnessAuthentication, HarnessAuthorizationOwner,
    INTERNAL_API_KEY_HEADER, INTERNAL_MACRO_USER_ID_HEADER, MacroAuthorization,
    MacroUserAuthentication,
};
use macro_user_id::user_id::MacroUserIdStr;
use model_user::UserContext;
use tower::ServiceExt;
use uuid::Uuid;

use super::*;
use crate::{
    domain::models::{
        AccessLevel, BotAccessScope, EditAccessLevel, EntityAccessAuth, EntityType, ViewAccessLevel,
    },
    inbound::axum_extractors::test_support::{
        AccessCall, BOT_ID, BOT_TEAM_ID, BotAccessCall, FakeAuthorizationService,
        FakeEntityAccessService, INTERNAL_KEY, TestState, USER_ID, VALID_BOT_TOKEN,
        user_scoped_bot_authentication,
    },
};

const INITIATIVE_ID: &str = "01a0a11f-b147-79fe-a5f1-87833710bbeb";
const HARNESS_ACTING_USER_ID: &str = "macro|harness-acting-user@example.com";

type ViewExtractor =
    InitiativeAccessExtractor<ViewAccessLevel, FakeEntityAccessService, FakeAuthorizationService>;
type EditExtractor =
    InitiativeAccessExtractor<EditAccessLevel, FakeEntityAccessService, FakeAuthorizationService>;

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
        .route("/initiatives/{initiative_id}", get(view_handler))
        .with_state(state)
}

fn edit_router(state: TestState) -> Router {
    Router::new()
        .route("/initiatives/{initiative_id}", get(edit_handler))
        .with_state(state)
}

fn request() -> axum::http::request::Builder {
    Request::get(format!("/initiatives/{INITIATIVE_ID}"))
}

fn bot_request(scope: BotScope, token: &str) -> Request<Body> {
    request()
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

fn user_authentication(user_id: &str) -> MacroUserAuthentication {
    MacroUserAuthentication {
        macro_user_id: MacroUserIdStr::try_from(user_id.to_string()).expect("valid user id"),
        user_context: UserContext {
            user_id: user_id.to_string(),
            fusion_user_id: "fusion-user-id".to_string(),
            organization_id: None,
            permissions: None,
        },
    }
}

fn caller_kind(caller: Caller<'_>) -> (&'static str, Option<String>) {
    match caller {
        Caller::Bot(_) => ("bot", None),
        Caller::InternalService => ("internal", None),
        Caller::Person(user) => ("person", user.map(|user_id| user_id.as_ref().to_string())),
    }
}

#[test]
fn caller_from_authorization_table() {
    let bot = user_scoped_bot_authentication();
    let user = user_authentication(USER_ID);
    let harness_acting_user = user_authentication(HARNESS_ACTING_USER_ID);
    let harness = HarnessAuthentication {
        harness_id: HarnessId::new_from_uuid(Uuid::from_u128(1)),
        token_id: Uuid::from_u128(2),
        owner: HarnessAuthorizationOwner::User {
            user_id: USER_ID.to_string(),
        },
        acting_user: harness_acting_user,
    };

    let cases = [
        (Some(MacroAuthorization::Bot(bot)), ("bot", None)),
        (Some(MacroAuthorization::Internal(None)), ("internal", None)),
        (
            Some(MacroAuthorization::Internal(Some(user.clone()))),
            ("person", Some(USER_ID.to_string())),
        ),
        (
            Some(MacroAuthorization::User(user)),
            ("person", Some(USER_ID.to_string())),
        ),
        (
            Some(MacroAuthorization::Harness(harness)),
            ("person", Some(HARNESS_ACTING_USER_ID.to_string())),
        ),
        (None, ("person", None)),
    ];

    for (authorization, expected) in cases {
        assert_eq!(
            caller_kind(Caller::from(authorization.as_ref())),
            expected,
            "authorization: {authorization:?}"
        );
    }
}

#[tokio::test]
async fn anonymous_caller_reaches_public_acl() {
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
            entity_id: INITIATIVE_ID.to_string(),
            entity_type: EntityType::Initiative,
        }]
    );
    assert!(state.entity_access.bot_calls().is_empty());
}

#[tokio::test]
async fn anonymous_caller_without_public_link_is_unauthorized() {
    let state = TestState::new(None);
    let response = view_router(state.clone())
        .oneshot(request().body(Body::empty()).unwrap())
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        state.entity_access.calls(),
        [AccessCall {
            user_id: None,
            entity_id: INITIATIVE_ID.to_string(),
            entity_type: EntityType::Initiative,
        }]
    );
}

#[tokio::test]
async fn authenticated_user_uses_acl() {
    let state = TestState::new(Some(AccessLevel::Edit));
    let response = edit_router(state.clone())
        .oneshot(
            request()
                .header(header::AUTHORIZATION, "Bearer valid")
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
async fn insufficient_level_is_unauthorized() {
    let state = TestState::new(Some(AccessLevel::View));
    let response = edit_router(state.clone())
        .oneshot(
            request()
                .header(header::AUTHORIZATION, "Bearer valid")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn identity_less_internal_receives_owner_without_acl_lookup() {
    let state = TestState::new(None);
    let response = edit_router(state.clone())
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
async fn internal_act_as_uses_acl() {
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
}

#[tokio::test]
async fn team_scoped_bot_uses_bot_policy() {
    let state = TestState::new(Some(AccessLevel::View));
    let response = view_router(state.clone())
        .oneshot(bot_request(BotScope::Team, VALID_BOT_TOKEN))
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
            entity_id: INITIATIVE_ID.to_string(),
            entity_type: EntityType::Initiative,
        }]
    );
    assert!(state.entity_access.calls().is_empty());
}

#[tokio::test]
async fn missing_path_parameter_is_bad_request() {
    let state = TestState::new(Some(AccessLevel::View));
    let response = Router::new()
        .route("/initiatives", get(view_handler))
        .with_state(state.clone())
        .oneshot(Request::get("/initiatives").body(Body::empty()).unwrap())
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert!(state.entity_access.calls().is_empty());
}

#[tokio::test]
async fn an_expired_token_is_still_an_authorization_error() {
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
