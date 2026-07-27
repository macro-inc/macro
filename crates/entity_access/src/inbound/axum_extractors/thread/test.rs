use std::sync::Arc;

use axum::{
    Router,
    body::{Body, to_bytes},
    extract::FromRef,
    http::{Request, StatusCode, header},
    routing::get,
};
use macro_authorization::{
    BOT_SCOPE_HEADER, BOT_TOKEN_HEADER, BotActingUserClaims, BotAuthentication, BotScope,
    INTERNAL_API_KEY_HEADER, INTERNAL_MACRO_USER_ID_HEADER, InternalIdentityClaims,
    MacroAuthorizationError, MacroAuthorizationService, MacroAuthorizationState,
};
use macro_user_id::user_id::MacroUserIdStr;
use model_user::UserContext;
use rootcause::Report;
use tower::ServiceExt;

use super::*;
use crate::{
    domain::models::{
        BotAccessScope, EditAccessLevel, EntityAccessAuth, EntityPermission, ViewAccessLevel,
    },
    inbound::axum_extractors::test_support::{
        AccessCall, BOT_ACTING_USER_ID, BOT_ACTING_USER_ORGANIZATION_ID, BOT_ID, BOT_TEAM_ID,
        BotAccessCall, FakeEntityAccessService, INTERNAL_KEY, MALFORMED_SYSTEM_BOT_TOKEN, USER_ID,
        VALID_BOT_TOKEN, malformed_system_bot_authentication, valid_bot_authentication,
    },
};

const THREAD_ID: &str = "thread-1";
const DEFAULT_INTERNAL_USER_ID: &str = "macro|INTERNAL@macro.com";
const NORMALIZED_DEFAULT_INTERNAL_USER_ID: &str = "macro|internal@macro.com";

type ViewExtractor =
    ThreadAccessLevelExtractor<ViewAccessLevel, FakeEntityAccessService, FakeAuthorizationService>;
type EditExtractor =
    ThreadAccessLevelExtractor<EditAccessLevel, FakeEntityAccessService, FakeAuthorizationService>;

#[derive(Clone, Debug, Default)]
struct FakeAuthorizationService {
    default_internal_user_id: Option<String>,
}

impl FakeAuthorizationService {
    fn with_default_internal_user() -> Self {
        Self {
            default_internal_user_id: Some(DEFAULT_INTERNAL_USER_ID.to_string()),
        }
    }
}

impl MacroAuthorizationService for FakeAuthorizationService {
    async fn authorize(&self, jwt: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        match jwt {
            "valid" => Ok(user_context(USER_ID)),
            "expired" => Err(Report::new(MacroAuthorizationError::CredentialsExpired)),
            _ => Err(Report::new(MacroAuthorizationError::InvalidCredentials)),
        }
    }

    async fn authorize_bot(
        &self,
        token: &str,
        bot_scope: BotScope,
        _claims: Option<BotActingUserClaims>,
    ) -> Result<BotAuthentication, Report<MacroAuthorizationError>> {
        match token {
            VALID_BOT_TOKEN => Ok(valid_bot_authentication(bot_scope)),
            MALFORMED_SYSTEM_BOT_TOKEN => Ok(malformed_system_bot_authentication(bot_scope)),
            _ => Err(Report::new(MacroAuthorizationError::InvalidCredentials)),
        }
    }

    async fn authorize_internal(
        &self,
        provided_key: &str,
        claims: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        if provided_key != INTERNAL_KEY {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }

        Ok(claims
            .user_id
            .or_else(|| self.default_internal_user_id.clone())
            .map(|user_id| user_context(&user_id)))
    }
}

fn user_context(user_id: &str) -> UserContext {
    UserContext {
        user_id: user_id.to_string(),
        fusion_user_id: "fusion-user-id".to_string(),
        organization_id: None,
        permissions: None,
    }
}

#[derive(Clone)]
struct TestState {
    entity_access: Arc<FakeEntityAccessService>,
    authorization: MacroAuthorizationState<FakeAuthorizationService>,
}

impl TestState {
    fn new(access_level: Option<AccessLevel>) -> Self {
        Self::with_authorization(access_level, FakeAuthorizationService::default())
    }

    fn with_authorization(
        access_level: Option<AccessLevel>,
        authorization: FakeAuthorizationService,
    ) -> Self {
        Self::with_service_and_authorization(
            FakeEntityAccessService::new(access_level),
            authorization,
        )
    }

    fn with_service(entity_access: FakeEntityAccessService) -> Self {
        Self::with_service_and_authorization(entity_access, FakeAuthorizationService::default())
    }

    fn with_service_and_authorization(
        entity_access: FakeEntityAccessService,
        authorization: FakeAuthorizationService,
    ) -> Self {
        Self {
            entity_access: Arc::new(entity_access),
            authorization: MacroAuthorizationState::new(Arc::new(authorization)),
        }
    }
}

impl FromRef<TestState> for Arc<FakeEntityAccessService> {
    fn from_ref(state: &TestState) -> Self {
        state.entity_access.clone()
    }
}

impl FromRef<TestState> for MacroAuthorizationState<FakeAuthorizationService> {
    fn from_ref(state: &TestState) -> Self {
        state.authorization.clone()
    }
}

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
        .route("/threads/{thread_id}", get(view_handler))
        .with_state(state)
}

fn edit_router(state: TestState) -> Router {
    Router::new()
        .route("/threads/{thread_id}", get(edit_handler))
        .with_state(state)
}

fn request() -> axum::http::request::Builder {
    Request::get(format!("/threads/{THREAD_ID}"))
}

async fn response_body(response: axum::response::Response) -> String {
    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("response body should be readable");
    String::from_utf8(body.to_vec()).expect("response body should be UTF-8")
}

fn expected_call(user_id: Option<&str>) -> AccessCall {
    AccessCall {
        user_id: user_id.map(str::to_string),
        entity_id: THREAD_ID.to_string(),
        entity_type: EntityType::EmailThread,
    }
}

#[tokio::test]
async fn anonymous_public_access_returns_unauthenticated_receipt() {
    let state = TestState::new(Some(AccessLevel::View));
    let response = view_router(state.clone())
        .oneshot(request().body(Body::empty()).unwrap())
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response_body(response).await, "unauthenticated");
    assert_eq!(state.entity_access.calls(), [expected_call(None)]);
}

#[tokio::test]
async fn anonymous_access_without_public_grant_is_rejected() {
    let state = TestState::new(None);
    let response = view_router(state.clone())
        .oneshot(request().body(Body::empty()).unwrap())
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(state.entity_access.calls(), [expected_call(None)]);
}

#[tokio::test]
async fn insufficient_public_access_is_rejected() {
    let state = TestState::new(Some(AccessLevel::View));
    let response = edit_router(state.clone())
        .oneshot(request().body(Body::empty()).unwrap())
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(state.entity_access.calls(), [expected_call(None)]);
}

#[tokio::test]
async fn authenticated_access_uses_the_users_acl() {
    let state = TestState::new(Some(AccessLevel::View));
    let response = view_router(state.clone())
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
    assert_eq!(state.entity_access.calls(), [expected_call(Some(USER_ID))]);
}

#[tokio::test]
async fn authenticated_access_with_insufficient_permission_is_rejected() {
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
    assert_eq!(state.entity_access.calls(), [expected_call(Some(USER_ID))]);
}

#[tokio::test]
async fn identity_free_internal_access_receives_owner_without_acl_lookup() {
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
async fn internal_acting_user_uses_the_users_acl() {
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
    assert_eq!(state.entity_access.calls(), [expected_call(Some(USER_ID))]);
}

#[tokio::test]
async fn default_internal_user_uses_the_users_acl() {
    let state = TestState::with_authorization(
        Some(AccessLevel::View),
        FakeAuthorizationService::with_default_internal_user(),
    );
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
    assert_eq!(response_body(response).await, "authenticated");
    assert_eq!(
        state.entity_access.calls(),
        [expected_call(Some(NORMALIZED_DEFAULT_INTERNAL_USER_ID))]
    );
}

#[tokio::test]
async fn user_scoped_bot_delegates_acting_user_access_to_the_scoped_service() {
    let state = TestState::with_service(FakeEntityAccessService::new(None).with_bot_permission(
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Owner,
        },
    ));
    let response = edit_router(state.clone())
        .oneshot(
            request()
                .header(BOT_TOKEN_HEADER, VALID_BOT_TOKEN)
                .header(BOT_SCOPE_HEADER, BotScope::User.as_str())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response_body(response).await, "bot");
    assert_eq!(
        state.entity_access.bot_calls(),
        [BotAccessCall {
            bot_id: BOT_ID,
            scope: BotAccessScope::User {
                user_id: MacroUserIdStr::try_from(BOT_ACTING_USER_ID.to_string())
                    .expect("acting user id should be valid"),
                user_org_id: Some(i64::from(BOT_ACTING_USER_ORGANIZATION_ID)),
            },
            entity_id: THREAD_ID.to_string(),
            entity_type: EntityType::EmailThread,
        }]
    );
    assert!(state.entity_access.calls().is_empty());
}

#[tokio::test]
async fn team_scoped_bot_receives_only_its_scoped_repository_access() {
    let state = TestState::with_service(
        FakeEntityAccessService::new(Some(AccessLevel::Owner)).with_bot_permission(
            EntityPermission::AccessLevel {
                access_level: AccessLevel::View,
            },
        ),
    );
    let response = view_router(state.clone())
        .oneshot(
            request()
                .header(BOT_TOKEN_HEADER, VALID_BOT_TOKEN)
                .header(BOT_SCOPE_HEADER, BotScope::Team.as_str())
                .body(Body::empty())
                .unwrap(),
        )
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
            entity_id: THREAD_ID.to_string(),
            entity_type: EntityType::EmailThread,
        }]
    );
    assert!(state.entity_access.calls().is_empty());
}

#[tokio::test]
async fn user_scoped_bot_without_an_acting_user_is_rejected() {
    let state = TestState::with_service(FakeEntityAccessService::new(None).with_bot_permission(
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Owner,
        },
    ));
    let response = view_router(state.clone())
        .oneshot(
            request()
                .header(BOT_TOKEN_HEADER, MALFORMED_SYSTEM_BOT_TOKEN)
                .header(BOT_SCOPE_HEADER, BotScope::User.as_str())
                .body(Body::empty())
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
async fn bot_with_insufficient_permission_is_rejected() {
    let state = TestState::with_service(FakeEntityAccessService::new(None).with_bot_permission(
        EntityPermission::AccessLevel {
            access_level: AccessLevel::View,
        },
    ));
    let response = edit_router(state.clone())
        .oneshot(
            request()
                .header(BOT_TOKEN_HEADER, VALID_BOT_TOKEN)
                .header(BOT_SCOPE_HEADER, BotScope::Team.as_str())
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(state.entity_access.bot_calls().len(), 1);
    assert!(state.entity_access.calls().is_empty());
}

#[tokio::test]
async fn invalid_internal_key_is_rejected_without_anonymous_fallback() {
    let state = TestState::new(Some(AccessLevel::Owner));
    let response = view_router(state.clone())
        .oneshot(
            request()
                .header(INTERNAL_API_KEY_HEADER, "invalid")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert!(state.entity_access.calls().is_empty());
}

#[tokio::test]
async fn invalid_jwt_is_rejected_without_anonymous_fallback() {
    let state = TestState::new(Some(AccessLevel::Owner));
    let response = view_router(state.clone())
        .oneshot(
            request()
                .header(header::AUTHORIZATION, "Bearer invalid")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert!(state.entity_access.calls().is_empty());
}

#[tokio::test]
async fn expired_jwt_is_rejected_without_anonymous_fallback() {
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
}
