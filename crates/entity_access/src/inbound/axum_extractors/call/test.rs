use crate::domain::models::TeamRole;
use std::sync::{Arc, Mutex};

use axum::{
    Json, Router,
    body::{Body, to_bytes},
    extract::{FromRef, State},
    http::{Request, StatusCode, header},
    routing::get,
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
use model_user::UserContext;
use rootcause::Report;
use serde_json::{Value, json};
use tower::ServiceExt;
use uuid::Uuid;

use super::*;
use crate::{
    domain::models::{
        AccessError, AccessLevel, BotAccessScope, BotId, CallChannelInfo, EditAccessLevel,
        MemberParticipantRole, OwnerParticipantRole, UserTeamInfo, ViewAccessLevel, ViewOnly,
    },
    inbound::axum_extractors::test_support::{
        BOT_ACTING_USER_ID, BOT_ACTING_USER_ORGANIZATION_ID, BOT_ID, BOT_TEAM_ID, BotAccessCall,
        MALFORMED_SYSTEM_BOT_TOKEN, VALID_BOT_TOKEN, malformed_system_bot_authentication,
        valid_bot_authentication,
    },
};

const CALL_ID: &str = "9e8e56e7-97e8-4148-9618-a63dacabf104";
const CHANNEL_ID: &str = "a1240db2-43c2-4974-92ad-70534f5f2ae8";
const SHARE_PERMISSION_ID: &str = "share-permission-1";
const USER_ID: &str = "macro|user@example.com";
const ACT_AS_ID: &str = "macro|act-as@example.com";
const DEFAULT_INTERNAL_ID: &str = "macro|default-internal@example.com";
const INTERNAL_KEY: &str = "valid-internal-key";
const ORGANIZATION_ID: i64 = 42;

#[derive(Clone, Copy)]
enum Variant {
    CallId,
    ChannelId,
}

impl Variant {
    fn path(self, id: &str) -> String {
        match self {
            Self::CallId => format!("/call/{id}"),
            Self::ChannelId => format!("/channel/{id}"),
        }
    }

    fn valid_path(self) -> String {
        match self {
            Self::CallId => self.path(CALL_ID),
            Self::ChannelId => self.path(CHANNEL_ID),
        }
    }

    fn entity_type(self) -> EntityType {
        match self {
            Self::CallId => EntityType::Call,
            Self::ChannelId => EntityType::Channel,
        }
    }

    fn entity_id(self) -> &'static str {
        match self {
            Self::CallId => CALL_ID,
            Self::ChannelId => CHANNEL_ID,
        }
    }

    fn expected_organization_id(self) -> Option<i64> {
        match self {
            Self::CallId => None,
            Self::ChannelId => Some(ORGANIZATION_ID),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct PermissionCall {
    user_id: Option<String>,
    entity_id: String,
    entity_type: EntityType,
    organization_id: Option<i64>,
}

#[derive(Clone, Debug)]
struct FakeEntityAccessService {
    call_info: Option<CallChannelInfo>,
    call_lookup_fails: bool,
    permission: EntityPermission,
    bot_permission: Option<EntityPermission>,
    permission_calls: Arc<Mutex<Vec<PermissionCall>>>,
    bot_calls: Arc<Mutex<Vec<BotAccessCall>>>,
}

impl FakeEntityAccessService {
    fn new(call_exists: bool, permission: EntityPermission) -> Self {
        Self {
            call_info: call_exists.then(|| CallChannelInfo {
                channel_id: Uuid::parse_str(CHANNEL_ID).expect("channel id should be valid"),
                share_permission_id: SHARE_PERMISSION_ID.to_string(),
            }),
            call_lookup_fails: false,
            permission,
            bot_permission: Some(permission),
            permission_calls: Arc::new(Mutex::new(Vec::new())),
            bot_calls: Arc::new(Mutex::new(Vec::new())),
        }
    }

    fn with_bot_permission(mut self, bot_permission: Option<EntityPermission>) -> Self {
        self.bot_permission = bot_permission;
        self
    }

    fn with_call_lookup_error(mut self) -> Self {
        self.call_lookup_fails = true;
        self
    }

    fn permission_calls(&self) -> Vec<PermissionCall> {
        self.permission_calls
            .lock()
            .expect("permission calls lock poisoned")
            .clone()
    }

    fn bot_calls(&self) -> Vec<BotAccessCall> {
        self.bot_calls
            .lock()
            .expect("bot calls lock poisoned")
            .clone()
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
        bot_id: BotId,
        scope: BotAccessScope,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        self.bot_calls
            .lock()
            .expect("bot calls lock poisoned")
            .push(BotAccessCall {
                bot_id,
                scope: scope.clone(),
                entity_id: entity_id.to_string(),
                entity_type,
            });

        let permission = self.bot_permission.ok_or(AccessError::Unauthorized)?;
        EntityAccessReceipt::try_new_bot(
            bot_id.into_storage_id(),
            (&scope).into(),
            Entity {
                entity_id: entity_id.to_string(),
                entity_type,
            },
            permission,
        )
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
        self.permission_calls
            .lock()
            .expect("permission calls lock poisoned")
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
        if self.call_lookup_fails {
            return Err(AccessError::Internal);
        }
        Ok(self.call_info.clone())
    }

    async fn get_call_channel_by_channel_id(
        &self,
        _channel_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        if self.call_lookup_fails {
            return Err(AccessError::Internal);
        }
        Ok(self.call_info.clone())
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

#[derive(Clone)]
struct TestState {
    entity_access: Arc<FakeEntityAccessService>,
    authorization: MacroAuthorizationState<FakeAuthorizationService>,
}

impl TestState {
    fn new(call_exists: bool, permission: EntityPermission) -> Self {
        Self::with_service_and_authorization(
            FakeEntityAccessService::new(call_exists, permission),
            FakeAuthorizationService::default(),
        )
    }

    fn with_bot_permission(
        call_exists: bool,
        permission: EntityPermission,
        bot_permission: Option<EntityPermission>,
    ) -> Self {
        Self::with_service_and_authorization(
            FakeEntityAccessService::new(call_exists, permission)
                .with_bot_permission(bot_permission),
            FakeAuthorizationService::default(),
        )
    }

    fn with_call_lookup_error(permission: EntityPermission) -> Self {
        Self::with_service_and_authorization(
            FakeEntityAccessService::new(true, permission).with_call_lookup_error(),
            FakeAuthorizationService::default(),
        )
    }

    fn with_authorization(
        call_exists: bool,
        permission: EntityPermission,
        authorization: FakeAuthorizationService,
    ) -> Self {
        Self::with_service_and_authorization(
            FakeEntityAccessService::new(call_exists, permission),
            authorization,
        )
    }

    fn with_service_and_authorization(
        service: FakeEntityAccessService,
        authorization: FakeAuthorizationService,
    ) -> Self {
        Self {
            entity_access: Arc::new(service),
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
        organization_id: Some(
            ORGANIZATION_ID
                .try_into()
                .expect("organization id should fit"),
        ),
        permissions: None,
    }
}

async fn call_handler(
    State(_state): State<TestState>,
    extracted: CallAccessLevelExtractor<
        MemberParticipantRole,
        FakeEntityAccessService,
        FakeAuthorizationService,
    >,
) -> Json<Value> {
    Json(receipt_json(
        &extracted.entity_access_receipt,
        &extracted.share_permission_id,
        extracted.channel_id,
    ))
}

async fn channel_handler(
    State(_state): State<TestState>,
    extracted: CallWithChannelIdAccessLevelExtractor<
        MemberParticipantRole,
        FakeEntityAccessService,
        FakeAuthorizationService,
    >,
) -> Json<Value> {
    Json(receipt_json(
        &extracted.entity_access_receipt,
        &extracted.share_permission_id,
        extracted.channel_id,
    ))
}

async fn call_view_handler(
    extracted: CallAccessLevelExtractor<
        ViewAccessLevel,
        FakeEntityAccessService,
        FakeAuthorizationService,
    >,
) -> Json<Value> {
    Json(receipt_json(
        &extracted.entity_access_receipt,
        &extracted.share_permission_id,
        extracted.channel_id,
    ))
}

async fn channel_view_handler(
    extracted: CallWithChannelIdAccessLevelExtractor<
        ViewOnly,
        FakeEntityAccessService,
        FakeAuthorizationService,
    >,
) -> Json<Value> {
    Json(receipt_json(
        &extracted.entity_access_receipt,
        &extracted.share_permission_id,
        extracted.channel_id,
    ))
}

fn receipt_json<T: RequiredPermission>(
    receipt: &EntityAccessReceipt<T>,
    share_permission_id: &str,
    channel_id: Uuid,
) -> Value {
    let (auth, user_id) = match receipt.auth() {
        EntityAccessAuth::Authenticated(user_id) => ("authenticated", Some(user_id.as_ref())),
        EntityAccessAuth::Bot(_) => ("bot", None),
        EntityAccessAuth::Internal => ("internal", None),
        EntityAccessAuth::Unauthenticated => ("unauthenticated", None),
    };
    let permission = match receipt.entity_permission() {
        EntityPermission::AccessLevel { access_level } => format!("{access_level:?}"),
        EntityPermission::ChannelViewOnly => "ViewOnly".to_string(),
        EntityPermission::ChannelRole { role } => format!("{role:?}"),
        EntityPermission::TeamRole { role } => format!("{role:?}"),
    };

    json!({
        "entity_id": receipt.entity().entity_id,
        "entity_type": receipt.entity().entity_type,
        "auth": auth,
        "user_id": user_id,
        "role": permission,
        "share_permission_id": share_permission_id,
        "channel_id": channel_id,
    })
}

fn router(state: TestState) -> Router {
    Router::new()
        .route("/call/{call_id}", get(call_handler))
        .route("/channel/{channel_id}", get(channel_handler))
        .with_state(state)
}

fn request(path: String, token: Option<&str>) -> Request<Body> {
    let mut request = Request::builder().uri(path);
    if let Some(token) = token {
        request = request.header(header::AUTHORIZATION, format!("Bearer {token}"));
    }
    request
        .body(Body::empty())
        .expect("request should be valid")
}

fn bot_request(path: String, scope: BotScope) -> Request<Body> {
    bot_request_with_token(path, scope, VALID_BOT_TOKEN)
}

fn bot_request_with_token(path: String, scope: BotScope, token: &str) -> Request<Body> {
    Request::builder()
        .uri(path)
        .header(BOT_TOKEN_HEADER, token)
        .header(BOT_SCOPE_HEADER, scope.as_str())
        .body(Body::empty())
        .expect("request should be valid")
}

fn internal_request(path: String, user_id: Option<&str>) -> Request<Body> {
    let mut request = Request::builder()
        .uri(path)
        .header(INTERNAL_API_KEY_HEADER, INTERNAL_KEY);
    if let Some(user_id) = user_id {
        request = request.header(INTERNAL_MACRO_USER_ID_HEADER, user_id);
    }
    request
        .body(Body::empty())
        .expect("request should be valid")
}

async fn send(state: &TestState, request: Request<Body>) -> (StatusCode, Value) {
    send_to(router(state.clone()), request).await
}

async fn send_to(router: Router, request: Request<Body>) -> (StatusCode, Value) {
    let response = router
        .oneshot(request)
        .await
        .expect("router should respond");
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("response body should be readable");
    let body = serde_json::from_slice(&bytes).expect("response should contain JSON");
    (status, body)
}

fn call_view_router(state: TestState) -> Router {
    Router::new()
        .route("/call/{call_id}", get(call_view_handler))
        .with_state(state)
}

fn channel_view_router(state: TestState) -> Router {
    Router::new()
        .route("/channel/{channel_id}", get(channel_view_handler))
        .with_state(state)
}

fn access_permission(access_level: AccessLevel) -> EntityPermission {
    EntityPermission::AccessLevel { access_level }
}

fn member_permission() -> EntityPermission {
    EntityPermission::ChannelRole {
        role: ParticipantRole::Member,
    }
}

#[tokio::test]
async fn authenticated_receipts_include_call_metadata_and_expected_acl_context() {
    for variant in [Variant::CallId, Variant::ChannelId] {
        let state = TestState::new(true, member_permission());
        let (status, body) = send(&state, request(variant.valid_path(), Some("valid"))).await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["entity_id"], variant.entity_id());
        assert_eq!(body["entity_type"], json!(variant.entity_type()));
        assert_eq!(body["auth"], "authenticated");
        assert_eq!(body["user_id"], USER_ID);
        assert_eq!(body["role"], "Member");
        assert_eq!(body["share_permission_id"], SHARE_PERMISSION_ID);
        assert_eq!(body["channel_id"], CHANNEL_ID);
        assert_eq!(
            state.entity_access.permission_calls(),
            [PermissionCall {
                user_id: Some(USER_ID.to_string()),
                entity_id: variant.entity_id().to_string(),
                entity_type: variant.entity_type(),
                organization_id: variant.expected_organization_id(),
            }]
        );
    }
}

#[tokio::test]
async fn insufficient_permission_is_rejected_for_both_variants() {
    for variant in [Variant::CallId, Variant::ChannelId] {
        let state = TestState::new(true, member_permission());
        let app = Router::new()
            .route(
                "/call/{call_id}",
                get(
                    |_: CallAccessLevelExtractor<
                        OwnerParticipantRole,
                        FakeEntityAccessService,
                        FakeAuthorizationService,
                    >| async {},
                ),
            )
            .route(
                "/channel/{channel_id}",
                get(
                    |_: CallWithChannelIdAccessLevelExtractor<
                        OwnerParticipantRole,
                        FakeEntityAccessService,
                        FakeAuthorizationService,
                    >| async {},
                ),
            )
            .with_state(state.clone());
        let response = app
            .oneshot(request(variant.valid_path(), Some("valid")))
            .await
            .expect("router should respond");

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(state.entity_access.permission_calls().len(), 1);
    }
}

#[tokio::test]
async fn missing_and_expired_credentials_are_rejected_for_both_variants() {
    for variant in [Variant::CallId, Variant::ChannelId] {
        let state = TestState::new(true, member_permission());
        let (status, _) = send(&state, request(variant.valid_path(), None)).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert!(state.entity_access.permission_calls().is_empty());

        let (status, body) = send(&state, request(variant.valid_path(), Some("expired"))).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(body, json!({ "message": "jwt expired" }));
        assert!(state.entity_access.permission_calls().is_empty());
    }
}

#[tokio::test]
async fn call_id_bot_scopes_request_call_access_and_preserve_call_metadata() {
    for (scope, expected_scope) in [
        (
            BotScope::User,
            BotAccessScope::User {
                user_id: MacroUserIdStr::try_from(BOT_ACTING_USER_ID.to_string())
                    .expect("bot acting user id should be valid"),
                user_org_id: Some(i64::from(BOT_ACTING_USER_ORGANIZATION_ID)),
            },
        ),
        (
            BotScope::Team,
            BotAccessScope::Team {
                team_id: BOT_TEAM_ID,
            },
        ),
    ] {
        let state = TestState::with_bot_permission(
            true,
            member_permission(),
            Some(access_permission(AccessLevel::Edit)),
        );
        let (status, body) = send_to(
            call_view_router(state.clone()),
            bot_request(Variant::CallId.valid_path(), scope),
        )
        .await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["entity_id"], CALL_ID);
        assert_eq!(body["entity_type"], json!(EntityType::Call));
        assert_eq!(body["auth"], "bot");
        assert_eq!(body["role"], "Edit");
        assert_eq!(body["share_permission_id"], SHARE_PERMISSION_ID);
        assert_eq!(body["channel_id"], CHANNEL_ID);
        assert_eq!(
            state.entity_access.bot_calls(),
            [BotAccessCall {
                bot_id: BOT_ID,
                scope: expected_scope,
                entity_id: CALL_ID.to_string(),
                entity_type: EntityType::Call,
            }]
        );
        assert!(state.entity_access.permission_calls().is_empty());
    }
}

#[tokio::test]
async fn channel_id_bot_scopes_request_channel_access_with_explicit_roles() {
    for (scope, expected_scope) in [
        (
            BotScope::User,
            BotAccessScope::User {
                user_id: MacroUserIdStr::try_from(BOT_ACTING_USER_ID.to_string())
                    .expect("bot acting user id should be valid"),
                user_org_id: Some(i64::from(BOT_ACTING_USER_ORGANIZATION_ID)),
            },
        ),
        (
            BotScope::Team,
            BotAccessScope::Team {
                team_id: BOT_TEAM_ID,
            },
        ),
    ] {
        let state =
            TestState::with_bot_permission(true, member_permission(), Some(member_permission()));
        let (status, body) =
            send(&state, bot_request(Variant::ChannelId.valid_path(), scope)).await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["entity_id"], CHANNEL_ID);
        assert_eq!(body["entity_type"], json!(EntityType::Channel));
        assert_eq!(body["auth"], "bot");
        assert_eq!(body["role"], "Member");
        assert_eq!(body["share_permission_id"], SHARE_PERMISSION_ID);
        assert_eq!(body["channel_id"], CHANNEL_ID);
        assert_eq!(
            state.entity_access.bot_calls(),
            [BotAccessCall {
                bot_id: BOT_ID,
                scope: expected_scope,
                entity_id: CHANNEL_ID.to_string(),
                entity_type: EntityType::Channel,
            }]
        );
        assert!(state.entity_access.permission_calls().is_empty());
    }
}

#[tokio::test]
async fn team_scoped_bot_can_view_its_team_channel_without_a_participant_role() {
    let state = TestState::with_bot_permission(
        true,
        member_permission(),
        Some(EntityPermission::ChannelViewOnly),
    );
    let (status, body) = send_to(
        channel_view_router(state.clone()),
        bot_request(Variant::ChannelId.valid_path(), BotScope::Team),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["auth"], "bot");
    assert_eq!(body["role"], "ViewOnly");
    assert_eq!(body["share_permission_id"], SHARE_PERMISSION_ID);
    assert_eq!(body["channel_id"], CHANNEL_ID);
}

#[tokio::test]
async fn team_scoped_bot_does_not_receive_implicit_public_channel_access() {
    let state = TestState::with_bot_permission(true, member_permission(), None);
    let (status, _) = send(
        &state,
        bot_request(Variant::ChannelId.valid_path(), BotScope::Team),
    )
    .await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(state.entity_access.bot_calls().len(), 1);
    assert!(state.entity_access.permission_calls().is_empty());
}

#[tokio::test]
async fn user_scoped_bot_without_an_acting_user_is_rejected_for_both_variants() {
    for variant in [Variant::CallId, Variant::ChannelId] {
        let state = TestState::new(true, member_permission());
        let (status, body) = send(
            &state,
            bot_request_with_token(
                variant.valid_path(),
                BotScope::User,
                MALFORMED_SYSTEM_BOT_TOKEN,
            ),
        )
        .await;

        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(
            body,
            json!({ "message": "bot user scope requires an acting user" })
        );
        assert!(state.entity_access.bot_calls().is_empty());
        assert!(state.entity_access.permission_calls().is_empty());
    }
}

#[tokio::test]
async fn bot_permissions_must_satisfy_each_extractors_required_level() {
    let call_state = TestState::with_bot_permission(
        true,
        member_permission(),
        Some(access_permission(AccessLevel::View)),
    );
    let call_app = Router::new()
        .route(
            "/call/{call_id}",
            get(
                |_: CallAccessLevelExtractor<
                    EditAccessLevel,
                    FakeEntityAccessService,
                    FakeAuthorizationService,
                >| async {},
            ),
        )
        .with_state(call_state.clone());
    let response = call_app
        .oneshot(bot_request(Variant::CallId.valid_path(), BotScope::Team))
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(call_state.entity_access.bot_calls().len(), 1);

    let channel_state = TestState::with_bot_permission(
        true,
        member_permission(),
        Some(EntityPermission::ChannelViewOnly),
    );
    let response = router(channel_state.clone())
        .oneshot(bot_request(Variant::ChannelId.valid_path(), BotScope::Team))
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(channel_state.entity_access.bot_calls().len(), 1);
}

#[tokio::test]
async fn malformed_ids_are_rejected_for_both_variants() {
    for variant in [Variant::CallId, Variant::ChannelId] {
        for request in [
            request(variant.path("not-a-uuid"), Some("valid")),
            bot_request(variant.path("not-a-uuid"), BotScope::Team),
        ] {
            let state = TestState::new(true, member_permission());
            let (status, _) = send(&state, request).await;

            assert_eq!(status, StatusCode::BAD_REQUEST);
            assert!(state.entity_access.permission_calls().is_empty());
            assert!(state.entity_access.bot_calls().is_empty());
        }
    }
}

#[tokio::test]
async fn missing_call_information_is_rejected_including_for_internal_requests() {
    for variant in [Variant::CallId, Variant::ChannelId] {
        for request in [
            request(variant.valid_path(), Some("valid")),
            internal_request(variant.valid_path(), None),
            bot_request(variant.valid_path(), BotScope::Team),
        ] {
            let state = TestState::new(false, member_permission());
            let (status, _) = send(&state, request).await;

            assert_eq!(status, StatusCode::NOT_FOUND);
            assert!(state.entity_access.permission_calls().is_empty());
            assert!(state.entity_access.bot_calls().is_empty());
        }
    }
}

#[tokio::test]
async fn call_lookup_errors_are_returned_before_bot_scope_or_acl_checks() {
    for variant in [Variant::CallId, Variant::ChannelId] {
        let state = TestState::with_call_lookup_error(member_permission());
        let (status, body) = send(
            &state,
            bot_request_with_token(
                variant.valid_path(),
                BotScope::User,
                MALFORMED_SYSTEM_BOT_TOKEN,
            ),
        )
        .await;

        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(body, json!({ "message": "Internal server error" }));
        assert!(state.entity_access.permission_calls().is_empty());
        assert!(state.entity_access.bot_calls().is_empty());
    }
}

#[tokio::test]
async fn identity_less_internal_requests_receive_owner_receipts_without_acl_calls() {
    for variant in [Variant::CallId, Variant::ChannelId] {
        let state = TestState::new(true, member_permission());
        let (status, body) = send(&state, internal_request(variant.valid_path(), None)).await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["entity_id"], variant.entity_id());
        assert_eq!(body["entity_type"], json!(variant.entity_type()));
        assert_eq!(body["auth"], "internal");
        assert_eq!(body["role"], "Owner");
        assert_eq!(body["share_permission_id"], SHARE_PERMISSION_ID);
        assert_eq!(body["channel_id"], CHANNEL_ID);
        assert!(state.entity_access.permission_calls().is_empty());
    }
}

#[tokio::test]
async fn internal_act_as_and_default_users_use_ordinary_acl_evaluation() {
    for variant in [Variant::CallId, Variant::ChannelId] {
        for (authorization, request, expected_user_id) in [
            (
                FakeAuthorizationService::default(),
                internal_request(variant.valid_path(), Some(ACT_AS_ID)),
                ACT_AS_ID,
            ),
            (
                FakeAuthorizationService {
                    default_internal_user_id: Some(DEFAULT_INTERNAL_ID.to_string()),
                },
                internal_request(variant.valid_path(), None),
                DEFAULT_INTERNAL_ID,
            ),
        ] {
            let state = TestState::with_authorization(true, member_permission(), authorization);
            let (status, body) = send(&state, request).await;

            assert_eq!(status, StatusCode::OK);
            assert_eq!(body["auth"], "authenticated");
            assert_eq!(body["user_id"], expected_user_id);
            assert_eq!(
                state.entity_access.permission_calls(),
                [PermissionCall {
                    user_id: Some(expected_user_id.to_string()),
                    entity_id: variant.entity_id().to_string(),
                    entity_type: variant.entity_type(),
                    organization_id: variant.expected_organization_id(),
                }]
            );
        }
    }
}
