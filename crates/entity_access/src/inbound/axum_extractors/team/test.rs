use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use axum::{
    body::{Body, to_bytes},
    extract::{FromRef, FromRequestParts},
    http::{Request, StatusCode, header},
    response::{IntoResponse, Response},
};
#[allow(deprecated)]
use macro_authorization::LEGACY_DSS_INTERNAL_API_KEY_HEADER;
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
use uuid::Uuid;

use super::*;
use crate::{
    domain::models::{
        AccessError, AccessLevel, AdminTeamRole, BotAccessScope, BotId, BotReceiptScope,
        CallChannelInfo, EntityAccessAuth, EntityPermission, MemberTeamRole, OwnerTeamRole,
        TeamRole, UserTeamInfo,
    },
    inbound::axum_extractors::test_support::{
        BOT_ACTING_USER_ID, BOT_ACTING_USER_ORGANIZATION_ID, BOT_ID, BOT_TEAM_ID, BotAccessCall,
        MALFORMED_SYSTEM_BOT_TOKEN, VALID_BOT_TOKEN, malformed_system_bot_authentication,
        valid_bot_authentication,
    },
};

const USER_ID: &str = "macro|team-member@example.com";
const ACT_AS_USER_ID: &str = "macro|internal-team-member@example.com";
const DSS_DEFAULT_USER_ID: &str = "macro|INTERNAL@macro.com";
const INTERNAL_KEY: &str = "valid-internal-key";
const TEAM_ID: Uuid = Uuid::from_u128(0x6d67fd9b_9906_40aa_9c0e_cab546cb80ad);

type V2Extractor = OptionalMacroUserTeamExtractorV2<
    AdminTeamRole,
    FakeEntityAccessService,
    FakeAuthorizationService,
>;
type OptionalMemberV2Extractor = OptionalMacroUserTeamExtractorV2<
    MemberTeamRole,
    FakeEntityAccessService,
    FakeAuthorizationService,
>;
type RequiredV2Extractor =
    MacroUserTeamExtractorV2<AdminTeamRole, FakeEntityAccessService, FakeAuthorizationService>;
type RequiredMemberV2Extractor =
    MacroUserTeamExtractorV2<MemberTeamRole, FakeEntityAccessService, FakeAuthorizationService>;
type RequiredOwnerV2Extractor =
    MacroUserTeamExtractorV2<OwnerTeamRole, FakeEntityAccessService, FakeAuthorizationService>;

#[derive(Clone, Debug, Default)]
struct FakeEntityAccessService {
    memberships: Arc<HashMap<String, UserTeamInfo>>,
    membership_lookups: Arc<Mutex<Vec<String>>>,
    bot_calls: Arc<Mutex<Vec<BotAccessCall>>>,
}

impl FakeEntityAccessService {
    fn with_membership(mut self, user_id: &str, role: TeamRole) -> Self {
        Arc::make_mut(&mut self.memberships).insert(
            user_id.to_string(),
            UserTeamInfo {
                team_id: TEAM_ID,
                role,
            },
        );
        self
    }

    fn membership_lookups(&self) -> Vec<String> {
        self.membership_lookups
            .lock()
            .expect("membership lookups lock poisoned")
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

        let requested_team_id = Uuid::parse_str(entity_id)
            .map_err(|_| AccessError::BadRequest("Invalid team ID format"))?;
        let role = match &scope {
            BotAccessScope::User { user_id, .. } => self
                .memberships
                .get(user_id.as_ref())
                .filter(|team| team.team_id == requested_team_id)
                .map(|team| team.role)
                .ok_or(AccessError::Unauthorized)?,
            BotAccessScope::Team { team_id } if *team_id == requested_team_id => TeamRole::Member,
            BotAccessScope::Team { .. } => return Err(AccessError::Unauthorized),
        };

        EntityAccessReceipt::try_new_bot(
            bot_id.into_storage_id(),
            (&scope).into(),
            Entity {
                entity_id: entity_id.to_string(),
                entity_type,
            },
            EntityPermission::TeamRole { role },
        )
    }

    async fn get_access_level(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Option<AccessLevel>, AccessError> {
        Err(AccessError::Internal)
    }

    async fn check_access(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        Err(AccessError::Internal)
    }

    async fn check_public_access(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        Err(AccessError::Internal)
    }

    async fn get_entity_permission(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _user_org_id: Option<i64>,
    ) -> Result<EntityPermission, AccessError> {
        Err(AccessError::Internal)
    }

    async fn get_crm_entity_permission_with_team(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<(EntityPermission, Uuid, TeamRole), AccessError> {
        Err(AccessError::Internal)
    }

    async fn get_users_by_entity(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        Err(AccessError::Internal)
    }

    async fn get_call_channel(
        &self,
        _call_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        Err(AccessError::Internal)
    }

    async fn get_call_channel_by_channel_id(
        &self,
        _channel_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        Err(AccessError::Internal)
    }

    async fn get_user_team(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Option<UserTeamInfo>, AccessError> {
        self.membership_lookups
            .lock()
            .expect("membership lookups lock poisoned")
            .push(user_id.as_ref().to_string());
        Ok(self.memberships.get(user_id.as_ref()).copied())
    }
}

#[derive(Clone, Debug, Default)]
struct FakeAuthorizationService {
    default_internal_user_id: Option<String>,
}

impl FakeAuthorizationService {
    fn with_default_internal_user(user_id: &str) -> Self {
        Self {
            default_internal_user_id: Some(user_id.to_string()),
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

struct TestState {
    entity_access: Arc<FakeEntityAccessService>,
    authorization: MacroAuthorizationState<FakeAuthorizationService>,
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

fn state(
    entity_access: FakeEntityAccessService,
    authorization: FakeAuthorizationService,
) -> TestState {
    TestState {
        entity_access: Arc::new(entity_access),
        authorization: MacroAuthorizationState::new(Arc::new(authorization)),
    }
}

fn request() -> Request<Body> {
    Request::new(Body::empty())
}

fn bearer_request(token: &str) -> Request<Body> {
    Request::builder()
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .expect("request should be valid")
}

fn bot_request(token: &str, scope: BotScope) -> Request<Body> {
    Request::builder()
        .header(BOT_TOKEN_HEADER, token)
        .header(BOT_SCOPE_HEADER, scope.as_str())
        .body(Body::empty())
        .expect("request should be valid")
}

async fn extract_v2(
    request: Request<Body>,
    state: &TestState,
) -> Result<V2Extractor, ExtractorError> {
    let (mut parts, _) = request.into_parts();
    V2Extractor::from_request_parts(&mut parts, state).await
}

async fn extract_optional_member_v2(
    request: Request<Body>,
    state: &TestState,
) -> Result<OptionalMemberV2Extractor, ExtractorError> {
    let (mut parts, _) = request.into_parts();
    OptionalMemberV2Extractor::from_request_parts(&mut parts, state).await
}

async fn extract_required_v2(
    request: Request<Body>,
    state: &TestState,
) -> Result<RequiredV2Extractor, ExtractorError> {
    let (mut parts, _) = request.into_parts();
    RequiredV2Extractor::from_request_parts(&mut parts, state).await
}

async fn extract_required_member_v2(
    request: Request<Body>,
    state: &TestState,
) -> Result<RequiredMemberV2Extractor, ExtractorError> {
    let (mut parts, _) = request.into_parts();
    RequiredMemberV2Extractor::from_request_parts(&mut parts, state).await
}

async fn extract_required_owner_v2(
    request: Request<Body>,
    state: &TestState,
) -> Result<RequiredOwnerV2Extractor, ExtractorError> {
    let (mut parts, _) = request.into_parts();
    RequiredOwnerV2Extractor::from_request_parts(&mut parts, state).await
}

async fn response_parts(response: Response) -> (StatusCode, String) {
    let status = response.status();
    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("response body should be readable");
    let body = String::from_utf8(body.to_vec()).expect("response body should be UTF-8");
    (status, body)
}

fn assert_receipt<T: RequiredPermission>(
    receipt: &EntityAccessReceipt<T>,
    user_id: &str,
    role: TeamRole,
) {
    assert_eq!(receipt.entity().entity_id, TEAM_ID.to_string());
    assert_eq!(receipt.entity().entity_type, EntityType::Team);
    assert!(matches!(
        receipt.auth(),
        EntityAccessAuth::Authenticated(actual_user_id) if actual_user_id.to_string() == user_id
    ));
    assert!(matches!(
        receipt.entity_permission(),
        EntityPermission::TeamRole { role: actual_role } if *actual_role == role
    ));
}

fn assert_bot_receipt<T: RequiredPermission>(
    receipt: &EntityAccessReceipt<T>,
    team_id: Uuid,
    role: TeamRole,
    scope: BotReceiptScope,
) {
    assert_eq!(receipt.entity().entity_id, team_id.to_string());
    assert_eq!(receipt.entity().entity_type, EntityType::Team);
    assert_eq!(receipt.get_authenticated_bot().unwrap().bot_id(), BOT_ID);
    assert_eq!(
        receipt.get_authenticated_bot_auth().unwrap().scope(),
        &scope
    );
    assert!(matches!(
        receipt.entity_permission(),
        EntityPermission::TeamRole { role: actual_role } if *actual_role == role
    ));
}

#[tokio::test]
async fn required_v2_accepts_bearer_credentials_for_a_qualifying_member() {
    let state = state(
        FakeEntityAccessService::default().with_membership(USER_ID, TeamRole::Admin),
        FakeAuthorizationService::default(),
    );

    let extracted = extract_required_v2(bearer_request("valid"), &state)
        .await
        .expect("qualifying bearer-authenticated membership should extract");

    assert_receipt(&extracted.entity_access_receipt, USER_ID, TeamRole::Admin);
}

#[tokio::test]
async fn required_v2_accepts_internal_acting_user_credentials() {
    let state = state(
        FakeEntityAccessService::default().with_membership(ACT_AS_USER_ID, TeamRole::Owner),
        FakeAuthorizationService::default(),
    );
    let request = Request::builder()
        .header(INTERNAL_API_KEY_HEADER, INTERNAL_KEY)
        .header(INTERNAL_MACRO_USER_ID_HEADER, ACT_AS_USER_ID)
        .body(Body::empty())
        .expect("request should be valid");

    let extracted = extract_required_v2(request, &state)
        .await
        .expect("qualifying internal acting-user membership should extract");

    assert_receipt(
        &extracted.entity_access_receipt,
        ACT_AS_USER_ID,
        TeamRole::Owner,
    );
}

#[tokio::test]
async fn required_v2_rejects_missing_credentials() {
    let state = state(
        FakeEntityAccessService::default(),
        FakeAuthorizationService::default(),
    );

    let error = extract_required_v2(request(), &state)
        .await
        .expect_err("required authorization should reject missing credentials");
    let (status, body) = response_parts(error.into_response()).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body, r#"{"message":"unauthorized"}"#);
}

#[tokio::test]
async fn required_v2_rejects_expired_credentials() {
    let state = state(
        FakeEntityAccessService::default(),
        FakeAuthorizationService::default(),
    );

    let error = extract_required_v2(bearer_request("expired"), &state)
        .await
        .expect_err("expired credentials should be rejected");
    let (status, body) = response_parts(error.into_response()).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body, r#"{"message":"jwt expired"}"#);
}

#[tokio::test]
async fn team_scoped_bot_gets_member_receipts_from_both_extractors() {
    let state = state(
        FakeEntityAccessService::default(),
        FakeAuthorizationService::default(),
    );

    let optional = extract_optional_member_v2(bot_request(VALID_BOT_TOKEN, BotScope::Team), &state)
        .await
        .expect("team-scoped bot should be authorized");
    let optional_receipt = optional
        .entity_access_receipt
        .expect("Member should satisfy optional team access");
    assert_bot_receipt(
        &optional_receipt,
        BOT_TEAM_ID,
        TeamRole::Member,
        BotReceiptScope::Team {
            team_id: BOT_TEAM_ID,
        },
    );

    let required = extract_required_member_v2(bot_request(VALID_BOT_TOKEN, BotScope::Team), &state)
        .await
        .expect("team-scoped bot should satisfy required Member access");
    assert_bot_receipt(
        &required.entity_access_receipt,
        BOT_TEAM_ID,
        TeamRole::Member,
        BotReceiptScope::Team {
            team_id: BOT_TEAM_ID,
        },
    );

    assert!(state.entity_access.membership_lookups().is_empty());
    assert_eq!(
        state.entity_access.bot_calls(),
        [
            BotAccessCall {
                bot_id: BOT_ID,
                scope: BotAccessScope::Team {
                    team_id: BOT_TEAM_ID,
                },
                entity_id: BOT_TEAM_ID.to_string(),
                entity_type: EntityType::Team,
            },
            BotAccessCall {
                bot_id: BOT_ID,
                scope: BotAccessScope::Team {
                    team_id: BOT_TEAM_ID,
                },
                entity_id: BOT_TEAM_ID.to_string(),
                entity_type: EntityType::Team,
            },
        ]
    );
}

#[tokio::test]
async fn team_scoped_bot_cannot_satisfy_admin_or_owner_requirements() {
    let state = state(
        FakeEntityAccessService::default(),
        FakeAuthorizationService::default(),
    );

    let optional = extract_v2(bot_request(VALID_BOT_TOKEN, BotScope::Team), &state)
        .await
        .expect("insufficient optional team access should still extract");
    assert!(optional.entity_access_receipt.is_none());

    let admin_error = extract_required_v2(bot_request(VALID_BOT_TOKEN, BotScope::Team), &state)
        .await
        .expect_err("team-scoped bot should not receive Admin access");
    assert!(matches!(
        admin_error,
        ExtractorError::UnauthorizedWithMessage("you do not have a high enough role")
    ));

    let owner_error =
        extract_required_owner_v2(bot_request(VALID_BOT_TOKEN, BotScope::Team), &state)
            .await
            .expect_err("team-scoped bot should not receive Owner access");
    assert!(matches!(
        owner_error,
        ExtractorError::UnauthorizedWithMessage("you do not have a high enough role")
    ));
}

#[tokio::test]
async fn user_scoped_bot_uses_acting_users_team_and_actual_admin_role() {
    let state = state(
        FakeEntityAccessService::default().with_membership(BOT_ACTING_USER_ID, TeamRole::Admin),
        FakeAuthorizationService::default(),
    );

    let extracted = extract_required_v2(bot_request(VALID_BOT_TOKEN, BotScope::User), &state)
        .await
        .expect("acting admin should satisfy required Admin access");

    assert_bot_receipt(
        &extracted.entity_access_receipt,
        TEAM_ID,
        TeamRole::Admin,
        BotReceiptScope::User {
            acting_user: MacroUserIdStr::try_from(BOT_ACTING_USER_ID.to_string())
                .expect("valid acting user id"),
        },
    );
    assert_eq!(
        state.entity_access.membership_lookups(),
        [BOT_ACTING_USER_ID.to_string()]
    );
    assert_eq!(
        state.entity_access.bot_calls(),
        [BotAccessCall {
            bot_id: BOT_ID,
            scope: BotAccessScope::User {
                user_id: MacroUserIdStr::try_from(BOT_ACTING_USER_ID.to_string())
                    .expect("valid acting user id"),
                user_org_id: Some(i64::from(BOT_ACTING_USER_ORGANIZATION_ID)),
            },
            entity_id: TEAM_ID.to_string(),
            entity_type: EntityType::Team,
        }]
    );
}

#[tokio::test]
async fn user_scoped_bot_without_acting_user_is_unauthorized() {
    let state = state(
        FakeEntityAccessService::default(),
        FakeAuthorizationService::default(),
    );

    let error = extract_required_v2(
        bot_request(MALFORMED_SYSTEM_BOT_TOKEN, BotScope::User),
        &state,
    )
    .await
    .expect_err("user scope without an acting user should fail");

    assert!(matches!(
        error,
        ExtractorError::UnauthorizedWithMessage("bot user scope requires an acting user")
    ));
    assert!(state.entity_access.membership_lookups().is_empty());
    assert!(state.entity_access.bot_calls().is_empty());
}

#[tokio::test]
async fn user_scoped_bot_without_team_membership_has_no_team_access() {
    let state = state(
        FakeEntityAccessService::default(),
        FakeAuthorizationService::default(),
    );

    let optional = extract_v2(bot_request(VALID_BOT_TOKEN, BotScope::User), &state)
        .await
        .expect("missing optional team access should still extract");
    assert!(optional.entity_access_receipt.is_none());

    let error = extract_required_v2(bot_request(VALID_BOT_TOKEN, BotScope::User), &state)
        .await
        .expect_err("acting user without a team should fail required extraction");
    assert!(matches!(
        error,
        ExtractorError::UnauthorizedWithMessage("not in a team")
    ));
    assert_eq!(
        state.entity_access.membership_lookups(),
        [
            BOT_ACTING_USER_ID.to_string(),
            BOT_ACTING_USER_ID.to_string(),
        ]
    );
    assert!(state.entity_access.bot_calls().is_empty());
}

#[tokio::test]
async fn team_scoped_bot_without_team_id_is_unauthorized() {
    let state = state(
        FakeEntityAccessService::default(),
        FakeAuthorizationService::default(),
    );

    let error = extract_required_member_v2(
        bot_request(MALFORMED_SYSTEM_BOT_TOKEN, BotScope::Team),
        &state,
    )
    .await
    .expect_err("team scope without an owning team should fail");

    assert!(matches!(error, ExtractorError::Unauthorized));
    assert!(state.entity_access.membership_lookups().is_empty());
    assert!(state.entity_access.bot_calls().is_empty());
}

#[tokio::test]
async fn required_v2_preserves_no_membership_error() {
    let state = state(
        FakeEntityAccessService::default(),
        FakeAuthorizationService::default(),
    );

    let error = extract_required_v2(bearer_request("valid"), &state)
        .await
        .expect_err("required extraction should reject absent membership");

    assert!(matches!(
        error,
        ExtractorError::UnauthorizedWithMessage("not in a team")
    ));
}

#[tokio::test]
async fn required_v2_preserves_insufficient_role_error() {
    let state = state(
        FakeEntityAccessService::default().with_membership(USER_ID, TeamRole::Member),
        FakeAuthorizationService::default(),
    );

    let error = extract_required_v2(bearer_request("valid"), &state)
        .await
        .expect_err("required extraction should reject an insufficient role");

    assert!(matches!(
        error,
        ExtractorError::UnauthorizedWithMessage("you do not have a high enough role")
    ));
}

#[tokio::test]
async fn required_v2_rejects_identity_less_internal_credentials() {
    let state = state(
        FakeEntityAccessService::default(),
        FakeAuthorizationService::default(),
    );
    let request = Request::builder()
        .header(INTERNAL_API_KEY_HEADER, INTERNAL_KEY)
        .body(Body::empty())
        .expect("request should be valid");

    let error = extract_required_v2(request, &state)
        .await
        .expect_err("required authorization should reject identity-less internal credentials");
    let (status, body) = response_parts(error.into_response()).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body, r#"{"message":"unauthorized"}"#);
}

#[tokio::test]
async fn qualifying_roles_return_authenticated_team_receipts() {
    for role in [TeamRole::Admin, TeamRole::Owner] {
        let state = state(
            FakeEntityAccessService::default().with_membership(USER_ID, role),
            FakeAuthorizationService::default(),
        );

        let extracted = extract_v2(bearer_request("valid"), &state)
            .await
            .expect("qualifying team membership should extract");
        let receipt = extracted
            .entity_access_receipt
            .expect("qualifying role should produce a receipt");

        assert_receipt(&receipt, USER_ID, role);
    }
}

#[tokio::test]
async fn non_qualifying_role_returns_no_receipt() {
    let state = state(
        FakeEntityAccessService::default().with_membership(USER_ID, TeamRole::Member),
        FakeAuthorizationService::default(),
    );

    let extracted = extract_v2(bearer_request("valid"), &state)
        .await
        .expect("insufficient team membership should still extract");

    assert!(extracted.entity_access_receipt.is_none());
}

#[tokio::test]
async fn absent_membership_returns_no_receipt() {
    let state = state(
        FakeEntityAccessService::default(),
        FakeAuthorizationService::default(),
    );

    let extracted = extract_v2(bearer_request("valid"), &state)
        .await
        .expect("a user without a team should still extract");

    assert!(extracted.entity_access_receipt.is_none());
}

#[tokio::test]
async fn missing_credentials_return_authorization_rejection() {
    let state = state(
        FakeEntityAccessService::default(),
        FakeAuthorizationService::default(),
    );

    let error = extract_v2(request(), &state)
        .await
        .expect_err("required authorization should reject missing credentials");
    let (status, body) = response_parts(error.into_response()).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body, r#"{"message":"unauthorized"}"#);
}

#[tokio::test]
async fn expired_credentials_preserve_authorization_response() {
    let state = state(
        FakeEntityAccessService::default(),
        FakeAuthorizationService::default(),
    );

    let error = extract_v2(bearer_request("expired"), &state)
        .await
        .expect_err("expired credentials should be rejected");
    let (status, body) = response_parts(error.into_response()).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body, r#"{"message":"jwt expired"}"#);
}

#[tokio::test]
async fn internal_act_as_identity_uses_ordinary_team_membership() {
    let state = state(
        FakeEntityAccessService::default().with_membership(ACT_AS_USER_ID, TeamRole::Owner),
        FakeAuthorizationService::default(),
    );
    let request = Request::builder()
        .header(INTERNAL_API_KEY_HEADER, INTERNAL_KEY)
        .header(INTERNAL_MACRO_USER_ID_HEADER, ACT_AS_USER_ID)
        .body(Body::empty())
        .expect("request should be valid");

    let extracted = extract_v2(request, &state)
        .await
        .expect("internal act-as membership should extract");
    let receipt = extracted
        .entity_access_receipt
        .expect("qualifying act-as membership should produce a receipt");

    assert_receipt(&receipt, ACT_AS_USER_ID, TeamRole::Owner);
}

#[allow(deprecated)]
#[tokio::test]
async fn dss_default_identity_without_team_returns_no_receipt() {
    let state = state(
        FakeEntityAccessService::default(),
        FakeAuthorizationService::with_default_internal_user(DSS_DEFAULT_USER_ID),
    );
    let request = Request::builder()
        .header(LEGACY_DSS_INTERNAL_API_KEY_HEADER, INTERNAL_KEY)
        .body(Body::empty())
        .expect("request should be valid");

    let extracted = extract_v2(request, &state)
        .await
        .expect("configured DSS default identity should authorize");

    assert!(extracted.entity_access_receipt.is_none());
}

#[tokio::test]
async fn identity_less_internal_request_is_unauthorized() {
    let state = state(
        FakeEntityAccessService::default(),
        FakeAuthorizationService::default(),
    );
    let request = Request::builder()
        .header(INTERNAL_API_KEY_HEADER, INTERNAL_KEY)
        .body(Body::empty())
        .expect("request should be valid");

    let error = extract_v2(request, &state)
        .await
        .expect_err("required authorization should reject an identity-less internal request");
    let (status, body) = response_parts(error.into_response()).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body, r#"{"message":"unauthorized"}"#);
}

#[test]
fn v2_clone_does_not_require_service_types_to_be_clone() {
    struct NotClone;

    fn assert_clone<T: Clone>() {}

    assert_clone::<OptionalMacroUserTeamExtractorV2<AdminTeamRole, NotClone, NotClone>>();
}
