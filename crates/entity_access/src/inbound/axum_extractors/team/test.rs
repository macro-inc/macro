use std::{collections::HashMap, sync::Arc};

use axum::{
    body::{Body, to_bytes},
    extract::{FromRef, FromRequestParts},
    http::{Request, StatusCode, header},
    response::{IntoResponse, Response},
};
#[allow(deprecated)]
use macro_authorization::LEGACY_DSS_INTERNAL_API_KEY_HEADER;
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
use uuid::Uuid;

use super::*;
use crate::domain::models::{
    AccessError, AccessLevel, AdminTeamRole, BotId, CallChannelInfo, EntityAccessAuth,
    EntityPermission, TeamRole, UserTeamInfo,
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
type RequiredV2Extractor =
    MacroUserTeamExtractorV2<AdminTeamRole, FakeEntityAccessService, FakeAuthorizationService>;

#[derive(Clone, Debug, Default)]
struct FakeEntityAccessService {
    memberships: Arc<HashMap<String, UserTeamInfo>>,
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
}

impl EntityAccessService for FakeEntityAccessService {
    async fn generate_entity_access_receipt<T: RequiredPermission>(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
        _user_org_id: Option<i64>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        Err(AccessError::Internal)
    }

    async fn generate_bot_entity_access_receipt<T: RequiredPermission>(
        &self,
        _bot_id: BotId,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        Err(AccessError::Internal)
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
    ) -> Result<(EntityPermission, Uuid), AccessError> {
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

async fn extract_v2(
    request: Request<Body>,
    state: &TestState,
) -> Result<V2Extractor, ExtractorError> {
    let (mut parts, _) = request.into_parts();
    V2Extractor::from_request_parts(&mut parts, state).await
}

async fn extract_required_v2(
    request: Request<Body>,
    state: &TestState,
) -> Result<RequiredV2Extractor, ExtractorError> {
    let (mut parts, _) = request.into_parts();
    RequiredV2Extractor::from_request_parts(&mut parts, state).await
}

async fn response_parts(response: Response) -> (StatusCode, String) {
    let status = response.status();
    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("response body should be readable");
    let body = String::from_utf8(body.to_vec()).expect("response body should be UTF-8");
    (status, body)
}

fn assert_receipt(receipt: &EntityAccessReceipt<AdminTeamRole>, user_id: &str, role: TeamRole) {
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
