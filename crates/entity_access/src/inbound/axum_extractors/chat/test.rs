use crate::domain::models::TeamRole;
use std::sync::{Arc, Mutex};

use axum::{
    body::{Body, to_bytes},
    extract::{FromRef, FromRequestParts},
    http::{Request, StatusCode, header},
    response::IntoResponse,
};
use macro_authorization::{
    BOT_SCOPE_HEADER, BOT_TOKEN_HEADER, BotActingUserClaims, BotAuthentication, BotScope,
    INTERNAL_API_KEY_HEADER, INTERNAL_MACRO_USER_ID_HEADER, InternalIdentityClaims,
    MacroAuthorizationError, MacroAuthorizationService, MacroAuthorizationState,
};
use macro_user_id::{
    lowercased::Lowercase,
    user_id::{MacroUserId, MacroUserIdStr},
};
use model::chat::ChatBasic;
use model_user::UserContext;
use rootcause::Report;
use uuid::Uuid;

use super::*;
use crate::{
    domain::models::{
        AccessError, BotId, CallChannelInfo, EditAccessLevel, EntityAccessAuth, UserTeamInfo,
        ViewAccessLevel,
    },
    inbound::axum_extractors::test_support::{VALID_BOT_TOKEN, valid_bot_authentication},
};

const CHAT_ID: &str = "chat-1";
const OWNER_ID: &str = "macro|owner@example.com";
const USER_ID: &str = "macro|user@example.com";
const ACT_AS_ID: &str = "macro|internal@example.com";
const DEFAULT_INTERNAL_ID: &str = "macro|default-internal@example.com";
const INTERNAL_KEY: &str = "valid-internal-key";

#[derive(Clone, Debug, Eq, PartialEq)]
struct AccessCall {
    user_id: Option<String>,
    entity_id: String,
    entity_type: EntityType,
}

#[derive(Clone, Debug)]
struct FakeEntityAccessService {
    access_level: Option<AccessLevel>,
    calls: Arc<Mutex<Vec<AccessCall>>>,
}

impl FakeEntityAccessService {
    fn new(access_level: Option<AccessLevel>) -> Self {
        Self {
            access_level,
            calls: Arc::new(Mutex::new(Vec::new())),
        }
    }

    fn calls(&self) -> Vec<AccessCall> {
        self.calls.lock().expect("calls lock poisoned").clone()
    }
}

impl EntityAccessService for FakeEntityAccessService {
    async fn generate_entity_access_receipt<T: RequiredPermission>(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
        _user_org_id: Option<i64>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        panic!("unexpected generate_entity_access_receipt call")
    }

    async fn generate_bot_entity_access_receipt<T: RequiredPermission>(
        &self,
        _bot_id: BotId,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        panic!("unexpected generate_bot_entity_access_receipt call")
    }

    async fn get_access_level(
        &self,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<Option<AccessLevel>, AccessError> {
        self.calls
            .lock()
            .expect("calls lock poisoned")
            .push(AccessCall {
                user_id: user_id.map(|id| id.as_ref().to_string()),
                entity_id: entity_id.to_string(),
                entity_type,
            });
        Ok(self.access_level)
    }

    async fn check_access(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        panic!("unexpected check_access call")
    }

    async fn check_public_access(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        panic!("unexpected check_public_access call")
    }

    async fn get_entity_permission(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _user_org_id: Option<i64>,
    ) -> Result<EntityPermission, AccessError> {
        panic!("unexpected get_entity_permission call")
    }

    async fn get_crm_entity_permission_with_team(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<(EntityPermission, Uuid, TeamRole), AccessError> {
        panic!("unexpected get_crm_entity_permission_with_team call")
    }

    async fn get_users_by_entity(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        panic!("unexpected get_users_by_entity call")
    }

    async fn get_call_channel(
        &self,
        _call_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        panic!("unexpected get_call_channel call")
    }

    async fn get_call_channel_by_channel_id(
        &self,
        _channel_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        panic!("unexpected get_call_channel_by_channel_id call")
    }

    async fn get_user_team(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Option<UserTeamInfo>, AccessError> {
        panic!("unexpected get_user_team call")
    }
}

#[derive(Clone, Debug, Default)]
struct FakeAuthorizationService {
    default_internal_user_id: Option<String>,
}

impl FakeAuthorizationService {
    fn with_default_internal_user() -> Self {
        Self {
            default_internal_user_id: Some(DEFAULT_INTERNAL_ID.to_string()),
        }
    }
}

impl MacroAuthorizationService for FakeAuthorizationService {
    async fn authorize(&self, jwt: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        match jwt {
            "owner" => Ok(user_context(OWNER_ID)),
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
        if token != VALID_BOT_TOKEN {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }

        Ok(valid_bot_authentication(bot_scope))
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
        Self {
            entity_access: Arc::new(FakeEntityAccessService::new(access_level)),
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

fn user_context(user_id: &str) -> UserContext {
    UserContext {
        user_id: user_id.to_string(),
        fusion_user_id: "fusion-user-id".to_string(),
        organization_id: None,
        permissions: None,
    }
}

fn chat(deleted: bool) -> ChatBasic {
    ChatBasic {
        id: CHAT_ID.to_string(),
        name: "Test chat".to_string(),
        user_id: MacroUserIdStr::parse_from_str(OWNER_ID).expect("owner id should be valid"),
        project_id: None,
        deleted_at: deleted.then(|| {
            "2026-01-01T00:00:00Z"
                .parse()
                .expect("deleted timestamp should be valid")
        }),
    }
}

fn request(token: Option<&str>, chat: ChatBasic) -> Request<Body> {
    let mut request = Request::new(Body::empty());
    request.extensions_mut().insert(chat);
    if let Some(token) = token {
        request.headers_mut().insert(
            header::AUTHORIZATION,
            format!("Bearer {token}")
                .parse()
                .expect("header should be valid"),
        );
    }
    request
}

fn internal_request(user_id: Option<&str>, chat: ChatBasic) -> Request<Body> {
    let mut request = request(None, chat);
    request.headers_mut().insert(
        INTERNAL_API_KEY_HEADER,
        INTERNAL_KEY.parse().expect("key should be valid"),
    );
    if let Some(user_id) = user_id {
        request.headers_mut().insert(
            INTERNAL_MACRO_USER_ID_HEADER,
            user_id.parse().expect("user id should be valid"),
        );
    }
    request
}

async fn extract<T: RequiredPermission>(
    request: Request<Body>,
    state: &TestState,
) -> Result<
    ChatAccessLevelExtractor<T, FakeEntityAccessService, FakeAuthorizationService>,
    ExtractorError,
> {
    let (mut parts, _) = request.into_parts();
    ChatAccessLevelExtractor::from_request_parts(&mut parts, state).await
}

#[tokio::test]
async fn anonymous_link_share_access_returns_unauthenticated_receipt() {
    let state = TestState::new(Some(AccessLevel::View));
    let extracted = extract::<ViewAccessLevel>(request(None, chat(false)), &state)
        .await
        .expect("public link access should be allowed");

    assert!(matches!(
        extracted.entity_access_receipt.auth(),
        EntityAccessAuth::Unauthenticated
    ));
    assert_eq!(state.entity_access.calls()[0].user_id, None);
}

#[tokio::test]
async fn authenticated_owner_bypasses_access_lookup() {
    let state = TestState::new(None);
    let extracted = extract::<EditAccessLevel>(request(Some("owner"), chat(false)), &state)
        .await
        .expect("the owner should be allowed");

    assert!(matches!(
        extracted.entity_access_receipt.entity_permission(),
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Owner
        }
    ));
    assert!(state.entity_access.calls().is_empty());
}

#[tokio::test]
async fn insufficient_access_is_rejected() {
    let state = TestState::new(Some(AccessLevel::View));
    let result = extract::<EditAccessLevel>(request(Some("valid"), chat(false)), &state).await;

    assert!(matches!(result, Err(ExtractorError::Unauthorized)));
}

#[tokio::test]
async fn deleted_chat_allows_owner_but_rejects_non_owner() {
    let owner_state = TestState::new(None);
    extract::<EditAccessLevel>(request(Some("owner"), chat(true)), &owner_state)
        .await
        .expect("the owner should access a deleted chat");

    let non_owner_state = TestState::new(Some(AccessLevel::Owner));
    let result =
        extract::<ViewAccessLevel>(request(Some("valid"), chat(true)), &non_owner_state).await;
    assert!(matches!(
        result,
        Err(ExtractorError::UnauthorizedWithMessage(
            "only owner can access deleted resource"
        ))
    ));
    assert!(non_owner_state.entity_access.calls().is_empty());
}

#[tokio::test]
async fn internal_act_as_uses_ordinary_acl_evaluation() {
    let state = TestState::new(Some(AccessLevel::Edit));
    let extracted =
        extract::<EditAccessLevel>(internal_request(Some(ACT_AS_ID), chat(false)), &state)
            .await
            .expect("internal act-as identity should use its ACL");

    assert!(matches!(
        extracted.entity_access_receipt.auth(),
        EntityAccessAuth::Authenticated(actual) if actual.as_ref() == ACT_AS_ID
    ));
    assert_eq!(
        state.entity_access.calls()[0].user_id.as_deref(),
        Some(ACT_AS_ID)
    );
}

#[tokio::test]
async fn default_internal_identity_uses_ordinary_acl_evaluation() {
    let state = TestState::with_authorization(
        Some(AccessLevel::View),
        FakeAuthorizationService::with_default_internal_user(),
    );
    let extracted = extract::<ViewAccessLevel>(internal_request(None, chat(false)), &state)
        .await
        .expect("default internal identity should use its ACL");

    assert!(matches!(
        extracted.entity_access_receipt.auth(),
        EntityAccessAuth::Authenticated(actual) if actual.as_ref() == DEFAULT_INTERNAL_ID
    ));
    assert_eq!(
        state.entity_access.calls()[0].user_id.as_deref(),
        Some(DEFAULT_INTERNAL_ID)
    );
}

#[tokio::test]
async fn identity_less_internal_request_receives_owner_without_acl_lookup() {
    let state = TestState::new(None);
    let extracted = extract::<EditAccessLevel>(internal_request(None, chat(false)), &state)
        .await
        .expect("identity-less internal access should be allowed");

    assert!(matches!(
        extracted.entity_access_receipt.auth(),
        EntityAccessAuth::Internal
    ));
    assert!(matches!(
        extracted.entity_access_receipt.entity_permission(),
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Owner
        }
    ));
    assert!(state.entity_access.calls().is_empty());
}

#[tokio::test]
async fn invalid_internal_credentials_are_rejected_without_acl_lookup() {
    let state = TestState::new(Some(AccessLevel::Owner));
    let mut request = internal_request(None, chat(false));
    request
        .headers_mut()
        .insert(INTERNAL_API_KEY_HEADER, "invalid".parse().unwrap());
    let error = extract::<ViewAccessLevel>(request, &state)
        .await
        .expect_err("invalid credentials should be rejected");
    let response = error.into_response();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert!(state.entity_access.calls().is_empty());
}

#[tokio::test]
async fn bot_credentials_are_forbidden_without_acl_lookup() {
    let state = TestState::new(Some(AccessLevel::Owner));
    let mut request = request(None, chat(false));
    request.headers_mut().insert(
        BOT_TOKEN_HEADER,
        VALID_BOT_TOKEN.parse().expect("bot token should be valid"),
    );
    request.headers_mut().insert(
        BOT_SCOPE_HEADER,
        BotScope::User
            .as_str()
            .parse()
            .expect("bot scope should be valid"),
    );
    let error = extract::<ViewAccessLevel>(request, &state)
        .await
        .expect_err("bot credentials should be forbidden");
    let response = error.into_response();

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("response body should be readable");
    assert_eq!(body.as_ref(), br#"{"message":"forbidden"}"#);
    assert!(state.entity_access.calls().is_empty());
}

#[tokio::test]
async fn expired_token_preserves_exact_unauthorized_json() {
    let state = TestState::new(Some(AccessLevel::Owner));
    let error = extract::<ViewAccessLevel>(request(Some("expired"), chat(false)), &state)
        .await
        .expect_err("expired credentials should be rejected");
    let response = error.into_response();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("response body should be readable");
    assert_eq!(body.as_ref(), br#"{"message":"jwt expired"}"#);
    assert!(state.entity_access.calls().is_empty());
}
