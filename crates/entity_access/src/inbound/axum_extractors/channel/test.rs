use std::sync::{Arc, Mutex};

use axum::{
    Router,
    body::{Body, to_bytes},
    extract::FromRef,
    http::{Request, StatusCode, header},
    routing::get,
};
use macro_authorization::{
    INTERNAL_API_KEY_HEADER, INTERNAL_MACRO_USER_ID_HEADER, InternalIdentityClaims,
    MacroAuthorizationError, MacroAuthorizationService, MacroAuthorizationState,
};
use macro_user_id::{
    lowercased::Lowercase,
    user_id::{MacroUserId, MacroUserIdStr},
};
use model_user::UserContext;
use rootcause::Report;
use tower::ServiceExt;
use uuid::Uuid;

use super::*;
use crate::domain::models::{
    AccessError, AccessLevel, AdminParticipantRole, BotId, CallChannelInfo, MemberParticipantRole,
    OwnerParticipantRole, UserTeamInfo,
};

const CHANNEL_ID: &str = "550e8400-e29b-41d4-a716-446655440000";
const USER_ID: &str = "macro|user@example.com";
const ACT_AS_ID: &str = "macro|internal@example.com";
const DEFAULT_INTERNAL_ID: &str = "macro|default@example.com";
const INTERNAL_KEY: &str = "valid-internal-key";
const ORGANIZATION_ID: i32 = 42;

#[derive(Clone, Debug, Eq, PartialEq)]
struct PermissionCall {
    user_id: Option<String>,
    entity_id: String,
    entity_type: EntityType,
    organization_id: Option<i64>,
}

#[derive(Clone)]
struct FakeEntityAccessService {
    permission: EntityPermission,
    calls: Arc<Mutex<Vec<PermissionCall>>>,
}

impl FakeEntityAccessService {
    fn new(permission: EntityPermission) -> Self {
        Self {
            permission,
            calls: Arc::new(Mutex::new(Vec::new())),
        }
    }

    fn calls(&self) -> Vec<PermissionCall> {
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
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Option<AccessLevel>, AccessError> {
        panic!("unexpected get_access_level call")
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
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
        entity_id: &str,
        entity_type: EntityType,
        organization_id: Option<i64>,
    ) -> Result<EntityPermission, AccessError> {
        self.calls
            .lock()
            .expect("calls lock poisoned")
            .push(PermissionCall {
                user_id: user_id.map(|id| id.as_ref().to_string()),
                entity_id: entity_id.to_string(),
                entity_type,
                organization_id,
            });
        Ok(self.permission)
    }

    async fn get_crm_entity_permission_with_team(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<(EntityPermission, Uuid), AccessError> {
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

#[derive(Clone, Default)]
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
            "valid" => Ok(user_context(USER_ID, Some(ORGANIZATION_ID))),
            "expired" => Err(Report::new(MacroAuthorizationError::CredentialsExpired)),
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
            .map(|user_id| user_context(&user_id, claims.organization_id)))
    }
}

#[derive(Clone)]
struct TestState {
    entity_access: Arc<FakeEntityAccessService>,
    authorization: MacroAuthorizationState<FakeAuthorizationService>,
}

impl TestState {
    fn new(permission: EntityPermission) -> Self {
        Self::with_authorization(permission, FakeAuthorizationService::default())
    }

    fn with_authorization(
        permission: EntityPermission,
        authorization: FakeAuthorizationService,
    ) -> Self {
        Self {
            entity_access: Arc::new(FakeEntityAccessService::new(permission)),
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

type MemberExtractor = ChannelAccessLevelExtractor<
    MemberParticipantRole,
    FakeEntityAccessService,
    FakeAuthorizationService,
>;
type AdminExtractor = ChannelAccessLevelExtractor<
    AdminParticipantRole,
    FakeEntityAccessService,
    FakeAuthorizationService,
>;
type OwnerExtractor = ChannelAccessLevelExtractor<
    OwnerParticipantRole,
    FakeEntityAccessService,
    FakeAuthorizationService,
>;

fn user_context(user_id: &str, organization_id: Option<i32>) -> UserContext {
    UserContext {
        user_id: user_id.to_string(),
        fusion_user_id: "fusion-user-id".to_string(),
        organization_id,
        permissions: None,
    }
}

fn request(token: Option<&str>) -> Request<Body> {
    let mut request = Request::builder()
        .uri(format!("/{CHANNEL_ID}"))
        .body(Body::empty())
        .expect("request should be valid");
    if let Some(token) = token {
        request.headers_mut().insert(
            header::AUTHORIZATION,
            format!("Bearer {token}")
                .parse()
                .expect("authorization header should be valid"),
        );
    }
    request
}

fn internal_request(user_id: Option<&str>) -> Request<Body> {
    let mut request = request(None);
    request.headers_mut().insert(
        INTERNAL_API_KEY_HEADER,
        INTERNAL_KEY.parse().expect("internal key should be valid"),
    );
    if let Some(user_id) = user_id {
        request.headers_mut().insert(
            INTERNAL_MACRO_USER_ID_HEADER,
            user_id.parse().expect("user id should be valid"),
        );
    }
    request
}

fn assert_member_receipt(receipt: &EntityAccessReceipt<MemberParticipantRole>) {
    assert_eq!(receipt.entity().entity_id, CHANNEL_ID);
    assert!(matches!(receipt.entity().entity_type, EntityType::Channel));
    assert!(matches!(
        receipt.entity_permission(),
        EntityPermission::ChannelRole {
            role: ParticipantRole::Member
        }
    ));
}

async fn member_handler(extractor: MemberExtractor) -> StatusCode {
    assert_member_receipt(&extractor.entity_access_receipt);
    StatusCode::OK
}

async fn authenticated_member_handler(extractor: MemberExtractor) -> StatusCode {
    let receipt = extractor.entity_access_receipt;
    assert_member_receipt(&receipt);
    assert!(matches!(
        receipt.auth(),
        EntityAccessAuth::Authenticated(user_id) if user_id.as_ref() == USER_ID
    ));
    StatusCode::OK
}

async fn admin_handler(_extractor: AdminExtractor) -> StatusCode {
    StatusCode::OK
}

async fn owner_handler(extractor: OwnerExtractor) -> StatusCode {
    assert!(matches!(
        extractor.entity_access_receipt.auth(),
        EntityAccessAuth::Internal
    ));
    assert!(matches!(
        extractor.entity_access_receipt.entity_permission(),
        EntityPermission::ChannelRole {
            role: ParticipantRole::Owner
        }
    ));
    StatusCode::OK
}

fn app<H, T>(state: TestState, handler: H) -> Router
where
    H: axum::handler::Handler<T, TestState>,
    T: 'static,
{
    Router::new()
        .route("/{channel_id}", get(handler))
        .with_state(state)
}

#[tokio::test]
async fn authenticated_access_forwards_organization_and_mints_receipt() {
    let state = TestState::new(EntityPermission::ChannelRole {
        role: ParticipantRole::Member,
    });
    let response = app(state.clone(), authenticated_member_handler)
        .oneshot(request(Some("valid")))
        .await
        .expect("request should complete");

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        state.entity_access.calls(),
        vec![PermissionCall {
            user_id: Some(USER_ID.to_string()),
            entity_id: CHANNEL_ID.to_string(),
            entity_type: EntityType::Channel,
            organization_id: Some(i64::from(ORGANIZATION_ID)),
        }]
    );
}

#[tokio::test]
async fn insufficient_permission_is_rejected() {
    let state = TestState::new(EntityPermission::ChannelRole {
        role: ParticipantRole::Member,
    });
    let response = app(state.clone(), admin_handler)
        .oneshot(request(Some("valid")))
        .await
        .expect("request should complete");

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(state.entity_access.calls().len(), 1);
}

#[tokio::test]
async fn missing_credentials_are_rejected_without_acl_call() {
    let state = TestState::new(EntityPermission::ChannelRole {
        role: ParticipantRole::Owner,
    });
    let response = app(state.clone(), member_handler)
        .oneshot(request(None))
        .await
        .expect("request should complete");

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert!(state.entity_access.calls().is_empty());
}

#[tokio::test]
async fn expired_token_preserves_exact_rejection() {
    let state = TestState::new(EntityPermission::ChannelRole {
        role: ParticipantRole::Owner,
    });
    let response = app(state.clone(), member_handler)
        .oneshot(request(Some("expired")))
        .await
        .expect("request should complete");

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("response body should be readable");
    assert_eq!(body.as_ref(), br#"{"message":"jwt expired"}"#);
    assert!(state.entity_access.calls().is_empty());
}

#[tokio::test]
async fn identity_less_internal_access_receives_owner_without_acl_call() {
    let state = TestState::new(EntityPermission::ChannelRole {
        role: ParticipantRole::Member,
    });
    let response = app(state.clone(), owner_handler)
        .oneshot(internal_request(None))
        .await
        .expect("request should complete");

    assert_eq!(response.status(), StatusCode::OK);
    assert!(state.entity_access.calls().is_empty());
}

async fn assert_internal_identity_uses_acl(
    state: TestState,
    request: Request<Body>,
    user_id: &str,
) {
    let response = app(state.clone(), member_handler)
        .oneshot(request)
        .await
        .expect("request should complete");

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        state.entity_access.calls()[0].user_id.as_deref(),
        Some(user_id)
    );
}

#[tokio::test]
async fn internal_act_as_identity_uses_ordinary_acl_evaluation() {
    let state = TestState::new(EntityPermission::ChannelRole {
        role: ParticipantRole::Member,
    });
    assert_internal_identity_uses_acl(state, internal_request(Some(ACT_AS_ID)), ACT_AS_ID).await;
}

#[tokio::test]
async fn default_internal_identity_uses_ordinary_acl_evaluation() {
    let state = TestState::with_authorization(
        EntityPermission::ChannelRole {
            role: ParticipantRole::Member,
        },
        FakeAuthorizationService::with_default_internal_user(),
    );
    assert_internal_identity_uses_acl(state, internal_request(None), DEFAULT_INTERNAL_ID).await;
}
