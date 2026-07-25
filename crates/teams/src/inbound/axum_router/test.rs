use std::{
    collections::HashSet,
    sync::{Arc, Mutex},
};

use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
    response::IntoResponse,
};
use entity_access::domain::{
    models::{
        AccessError, AccessLevel, AdminTeamRole, BotId, CallChannelInfo, EntityAccessReceipt,
        EntityPermission, EntityType, MemberTeamRole, RequiredPermission, TeamRole, UserTeamInfo,
    },
    ports::EntityAccessService,
};
use macro_authorization::{
    INTERNAL_API_KEY_HEADER, INTERNAL_MACRO_USER_ID_HEADER, InternalIdentityClaims,
    MacroAuthorizationError, MacroAuthorizationRejection, MacroAuthorizationService,
    MacroAuthorizationState,
};
use macro_user_id::{
    email::Email,
    lowercased::Lowercase,
    user_id::{MacroUserId, MacroUserIdStr},
};
use model_user::UserContext;
use roles_and_permissions::domain::model::PermissionId;
use rootcause::Report;
use serde_json::{Value, json};
use tower::ServiceExt;

use crate::domain::{
    model::{
        CreateTeamError, CustomerError, DeleteTeamError, InviteUsersToTeamError, JoinTeamError,
        PatchTeamCrmSettingsResponse, PatchTeamRequest, RemoveTeamInviteError,
        RemoveUserFromTeamError, RestorePermissionsForTeamMembersError,
        RevokePermissionsForTeamMembersError, Team, TeamError, TeamInvite, TeamInviteDetails,
        TeamMember, TeamWithMembers, ToggleAutoJoinDomainError, TryJoinTeamByDomainError,
    },
    team_repo::TeamService,
};

use super::{
    TeamRouterState, invite_to_team::InviteToTeamError, premium_user::PremiumUserRejection,
    teams_router,
};

const CUSTOMER_ERROR_SENTINEL: &str = "sentinel customer repository failure";

fn customer_error() -> CustomerError {
    CustomerError::StorageLayerError(anyhow::anyhow!(CUSTOMER_ERROR_SENTINEL))
}

async fn response_parts(error: impl IntoResponse) -> (StatusCode, String, Value) {
    let response = error.into_response();
    let status = response.status();
    let body = to_bytes(response.into_body(), usize::MAX)
        .await
        .expect("error response body should be readable");
    let body_text = String::from_utf8(body.to_vec()).expect("error response body should be UTF-8");
    let body_json =
        serde_json::from_slice(&body).expect("error response body should contain valid JSON");

    (status, body_text, body_json)
}

async fn assert_customer_error_is_obfuscated(error: impl IntoResponse) {
    let (status, body_text, body_json) = response_parts(error).await;

    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(body_text, r#"{"message":"internal server error"}"#);
    assert_eq!(body_json, json!({ "message": "internal server error" }));
    assert!(!body_text.contains(CUSTOMER_ERROR_SENTINEL));
}

#[tokio::test]
async fn delete_team_customer_error_response_is_obfuscated() {
    assert_customer_error_is_obfuscated(DeleteTeamError::CustomerError(customer_error())).await;
}

#[tokio::test]
async fn invite_users_to_team_customer_error_response_is_obfuscated() {
    assert_customer_error_is_obfuscated(InviteUsersToTeamError::CustomerError(customer_error()))
        .await;
}

#[tokio::test]
async fn invite_to_team_customer_error_response_is_obfuscated_but_display_retains_details() {
    let error = InviteToTeamError::InviteUsersToTeamError(InviteUsersToTeamError::CustomerError(
        customer_error(),
    ));

    assert!(error.to_string().contains(CUSTOMER_ERROR_SENTINEL));
    assert_customer_error_is_obfuscated(error).await;
}

#[tokio::test]
async fn join_team_customer_error_response_is_obfuscated() {
    assert_customer_error_is_obfuscated(JoinTeamError::CustomerError(customer_error())).await;
}

#[tokio::test]
async fn remove_team_invite_customer_error_response_is_obfuscated() {
    assert_customer_error_is_obfuscated(RemoveTeamInviteError::CustomerError(customer_error()))
        .await;
}

#[tokio::test]
async fn remove_user_from_team_customer_error_response_is_obfuscated() {
    assert_customer_error_is_obfuscated(RemoveUserFromTeamError::CustomerError(customer_error()))
        .await;
}

#[tokio::test]
async fn invite_to_team_validation_error_response_is_preserved() {
    let (status, body_text, _) = response_parts(InviteToTeamError::InvalidEmails).await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body_text, r#"{"message":"invalid emails detected"}"#);
}

#[tokio::test]
async fn invite_to_free_team_at_capacity_returns_bad_request() {
    let error =
        InviteToTeamError::InviteUsersToTeamError(InviteUsersToTeamError::NotEnoughOpenSeats);
    let (status, body_text, _) = response_parts(error).await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        body_text,
        r#"{"message":"free team member limit reached; upgrade to invite more members"}"#
    );
}

#[tokio::test]
async fn remove_team_invite_not_found_response_is_preserved() {
    let (status, body_text, _) =
        response_parts(RemoveTeamInviteError::TeamInviteDoesNotExist).await;

    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body_text, r#"{"message":"team invite does not exist"}"#);
}

#[tokio::test]
async fn remove_team_owner_validation_response_is_preserved() {
    let (status, body_text, _) = response_parts(RemoveUserFromTeamError::CannotRemoveOwner).await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body_text, r#"{"message":"cannot remove owner"}"#);
}

#[tokio::test]
async fn toggle_auto_join_domain_generic_domain_response_is_bad_request() {
    let (status, body_text, _) = response_parts(
        ToggleAutoJoinDomainError::GenericDomainNotAllowed("gmail.com".to_string()),
    )
    .await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body_text.contains("gmail.com"));
}

#[tokio::test]
async fn toggle_auto_join_domain_storage_error_response_is_obfuscated() {
    let (status, body_text, body_json) = response_parts(ToggleAutoJoinDomainError::TeamError(
        TeamError::StorageLayerError(anyhow::anyhow!(CUSTOMER_ERROR_SENTINEL)),
    ))
    .await;

    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(body_text, r#"{"message":"internal server error"}"#);
    assert_eq!(body_json, json!({ "message": "internal server error" }));
}

#[tokio::test]
async fn toggle_auto_join_domain_missing_team_response_is_not_found() {
    let (status, body_text, _) = response_parts(ToggleAutoJoinDomainError::TeamError(
        TeamError::TeamDoesNotExist,
    ))
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body_text, r#"{"message":"team does not exist"}"#);
}

const USER_ID: &str = "macro|user@example.com";
const ACTING_USER_ID: &str = "macro|acting@example.com";
const INTERNAL_KEY: &str = "valid-internal-key";
const TEAM_ID: uuid::Uuid = uuid::Uuid::from_u128(42);

#[derive(Clone, Debug, Eq, PartialEq)]
struct TeamReceiptCall {
    user_id: String,
    team_id: String,
    role: TeamRole,
}

#[derive(Clone, Default)]
struct FakeTeamService {
    user_calls: Arc<Mutex<Vec<String>>>,
    team_receipt_calls: Arc<Mutex<Vec<TeamReceiptCall>>>,
}

impl FakeTeamService {
    fn user_calls(&self) -> Vec<String> {
        self.user_calls
            .lock()
            .expect("user calls lock poisoned")
            .clone()
    }

    fn team_receipt_calls(&self) -> Vec<TeamReceiptCall> {
        self.team_receipt_calls
            .lock()
            .expect("team receipt calls lock poisoned")
            .clone()
    }
}

impl TeamService for FakeTeamService {
    async fn create_team(
        &self,
        _user_id: &MacroUserIdStr<'_>,
        _team_name: &str,
        _subscription_id: Option<&stripe::SubscriptionId>,
    ) -> Result<Team, CreateTeamError> {
        panic!("unexpected create_team call")
    }

    async fn is_user_premium(
        &self,
        _user_id: &MacroUserIdStr<'_>,
    ) -> Result<Option<stripe::SubscriptionId>, TeamError> {
        panic!("unexpected is_user_premium call")
    }

    async fn invite_users_to_team(
        &self,
        _entity_access_receipt: EntityAccessReceipt<MemberTeamRole>,
        _invites: non_empty::NonEmpty<&[Email<Lowercase<'_>>]>,
    ) -> Result<Vec<TeamInvite<'_>>, InviteUsersToTeamError> {
        panic!("unexpected invite_users_to_team call")
    }

    async fn remove_user_from_team(
        &self,
        _entity_access_receipt: EntityAccessReceipt<AdminTeamRole>,
        _user_id: &MacroUserIdStr<'_>,
    ) -> Result<(), RemoveUserFromTeamError> {
        panic!("unexpected remove_user_from_team call")
    }

    async fn reject_invitation(
        &self,
        _user_id: &MacroUserIdStr<'_>,
        _team_invite_id: &uuid::Uuid,
    ) -> Result<(), RemoveTeamInviteError> {
        panic!("unexpected reject_invitation call")
    }

    async fn delete_team_invite(
        &self,
        _entity_access_receipt: EntityAccessReceipt<AdminTeamRole>,
        _team_invite_id: &uuid::Uuid,
    ) -> Result<(), RemoveTeamInviteError> {
        panic!("unexpected delete_team_invite call")
    }

    async fn delete_team(
        &self,
        _entity_access_receipt: EntityAccessReceipt<entity_access::domain::models::OwnerTeamRole>,
    ) -> Result<(), DeleteTeamError> {
        panic!("unexpected delete_team call")
    }

    async fn join_team(
        &self,
        _team_invite_id: &uuid::Uuid,
        _user_id: &MacroUserIdStr<'_>,
    ) -> Result<TeamMember<'_>, JoinTeamError> {
        panic!("unexpected join_team call")
    }

    async fn revoke_permissions_for_team_members(
        &self,
        _team_id: &uuid::Uuid,
    ) -> Result<(), RevokePermissionsForTeamMembersError> {
        panic!("unexpected revoke_permissions_for_team_members call")
    }

    async fn restore_permissions_for_team_members(
        &self,
        _team_id: &uuid::Uuid,
    ) -> Result<(), RestorePermissionsForTeamMembersError> {
        panic!("unexpected restore_permissions_for_team_members call")
    }

    async fn patch_team_subscription_id(
        &self,
        _team_id: &uuid::Uuid,
        _subscription_id: &stripe::SubscriptionId,
    ) -> Result<(), TeamError> {
        panic!("unexpected patch_team_subscription_id call")
    }

    async fn patch_team_payment_status(
        &self,
        _team_id: &uuid::Uuid,
        _paying: bool,
    ) -> Result<(), TeamError> {
        panic!("unexpected patch_team_payment_status call")
    }

    async fn get_team(
        &self,
        _entity_access_receipt: EntityAccessReceipt<entity_access::domain::models::MemberTeamRole>,
    ) -> Result<TeamWithMembers, TeamError> {
        panic!("unexpected get_team call")
    }

    async fn get_user_teams(&self, user_id: &MacroUserIdStr<'_>) -> Result<Vec<Team>, TeamError> {
        self.user_calls
            .lock()
            .expect("user calls lock poisoned")
            .push(user_id.to_string());
        Ok(Vec::new())
    }

    async fn get_user_invites(
        &self,
        _user_id: &MacroUserIdStr<'_>,
    ) -> Result<Vec<TeamInviteDetails>, TeamError> {
        panic!("unexpected get_user_invites call")
    }

    async fn get_team_invites(
        &self,
        entity_access_receipt: EntityAccessReceipt<AdminTeamRole>,
    ) -> Result<Vec<TeamInviteDetails>, TeamError> {
        let user_id = entity_access_receipt
            .get_authenticated_user()
            .expect("team receipts should authenticate a user")
            .to_string();
        let EntityPermission::TeamRole { role } = entity_access_receipt.entity_permission() else {
            panic!("team receipt should contain a team role")
        };
        self.team_receipt_calls
            .lock()
            .expect("team receipt calls lock poisoned")
            .push(TeamReceiptCall {
                user_id,
                team_id: entity_access_receipt.entity().entity_id.clone(),
                role: *role,
            });
        Ok(Vec::new())
    }

    async fn patch_team(
        &self,
        _entity_access_receipt: EntityAccessReceipt<AdminTeamRole>,
        _req: &PatchTeamRequest,
    ) -> Result<(), TeamError> {
        panic!("unexpected patch_team call")
    }

    async fn get_team_user_permissions(
        &self,
        _user_id: &MacroUserIdStr<'_>,
    ) -> Result<HashSet<PermissionId>, TeamError> {
        panic!("unexpected get_team_user_permissions call")
    }

    async fn set_team_crm_enabled(
        &self,
        _entity_access_receipt: EntityAccessReceipt<AdminTeamRole>,
        _enabled: bool,
        _backfill: bool,
    ) -> Result<PatchTeamCrmSettingsResponse, TeamError> {
        panic!("unexpected set_team_crm_enabled call")
    }

    async fn toggle_auto_join_domain(
        &self,
        _entity_access_receipt: EntityAccessReceipt<AdminTeamRole>,
    ) -> Result<Option<String>, ToggleAutoJoinDomainError> {
        panic!("unexpected toggle_auto_join_domain call")
    }

    async fn toggle_allow_non_admin_invites(
        &self,
        _entity_access_receipt: EntityAccessReceipt<AdminTeamRole>,
    ) -> Result<bool, TeamError> {
        panic!("unexpected toggle_allow_non_admin_invites call")
    }

    async fn try_join_team_by_domain(
        &self,
        _user_id: &MacroUserIdStr<'_>,
    ) -> Result<Option<TeamMember<'static>>, TryJoinTeamByDomainError> {
        panic!("unexpected try_join_team_by_domain call")
    }
}

#[derive(Clone, Default)]
struct FakeEntityAccessService {
    membership: Option<(String, TeamRole)>,
}

impl FakeEntityAccessService {
    fn with_membership(user_id: &str, role: TeamRole) -> Self {
        Self {
            membership: Some((user_id.to_string(), role)),
        }
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
    ) -> Result<(EntityPermission, uuid::Uuid, TeamRole), AccessError> {
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
        _call_id: &uuid::Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        panic!("unexpected get_call_channel call")
    }

    async fn get_call_channel_by_channel_id(
        &self,
        _channel_id: &uuid::Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        panic!("unexpected get_call_channel_by_channel_id call")
    }

    async fn get_user_team(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Option<UserTeamInfo>, AccessError> {
        let Some((member_id, role)) = &self.membership else {
            return Ok(None);
        };
        if member_id != user_id.as_ref() {
            return Ok(None);
        }
        Ok(Some(UserTeamInfo {
            team_id: TEAM_ID,
            role: *role,
        }))
    }
}

#[derive(Clone, Default)]
struct FakeAuthorizationService;

impl MacroAuthorizationService for FakeAuthorizationService {
    async fn authorize(&self, jwt: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        if jwt == "valid" {
            return Ok(user_context(USER_ID));
        }
        Err(Report::new(MacroAuthorizationError::InvalidCredentials))
    }

    async fn authorize_internal(
        &self,
        provided_key: &str,
        claims: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        if provided_key != INTERNAL_KEY {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }
        Ok(claims.user_id.as_deref().map(user_context))
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

fn router(service: FakeTeamService, entity_access: FakeEntityAccessService) -> Router {
    teams_router(TeamRouterState {
        service: Arc::new(service),
        entity_access_service: Arc::new(entity_access),
        authorization_state: MacroAuthorizationState::new(Arc::new(FakeAuthorizationService)),
    })
}

fn get_user_teams_request() -> axum::http::request::Builder {
    Request::get("/user")
}

#[tokio::test]
async fn teams_router_authorizes_bearer_credentials() {
    let service = FakeTeamService::default();
    let response = router(service.clone(), FakeEntityAccessService::default())
        .oneshot(
            get_user_teams_request()
                .header(header::AUTHORIZATION, "Bearer valid")
                .body(Body::empty())
                .expect("request should be valid"),
        )
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(service.user_calls(), vec![USER_ID]);
}

#[tokio::test]
async fn teams_router_rejects_missing_credentials() {
    let service = FakeTeamService::default();
    let response = router(service.clone(), FakeEntityAccessService::default())
        .oneshot(
            get_user_teams_request()
                .body(Body::empty())
                .expect("request should be valid"),
        )
        .await
        .expect("router should respond");
    let (status, body, _) = response_parts(response).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(body, r#"{"message":"unauthorized"}"#);
    assert!(service.user_calls().is_empty());
}

#[tokio::test]
async fn teams_router_accepts_internal_acting_user_credentials() {
    let service = FakeTeamService::default();
    let response = router(service.clone(), FakeEntityAccessService::default())
        .oneshot(
            get_user_teams_request()
                .header(INTERNAL_API_KEY_HEADER, INTERNAL_KEY)
                .header(INTERNAL_MACRO_USER_ID_HEADER, ACTING_USER_ID)
                .body(Body::empty())
                .expect("request should be valid"),
        )
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(service.user_calls(), vec![ACTING_USER_ID]);
}

#[tokio::test]
async fn teams_router_uses_entity_access_team_receipts() {
    let admin_service = FakeTeamService::default();
    let admin_response = router(
        admin_service.clone(),
        FakeEntityAccessService::with_membership(USER_ID, TeamRole::Admin),
    )
    .oneshot(
        Request::get("/invites")
            .header(header::AUTHORIZATION, "Bearer valid")
            .body(Body::empty())
            .expect("request should be valid"),
    )
    .await
    .expect("router should respond");

    assert_eq!(admin_response.status(), StatusCode::OK);
    assert_eq!(
        admin_service.team_receipt_calls(),
        vec![TeamReceiptCall {
            user_id: USER_ID.to_string(),
            team_id: TEAM_ID.to_string(),
            role: TeamRole::Admin,
        }]
    );

    let member_service = FakeTeamService::default();
    let member_response = router(
        member_service.clone(),
        FakeEntityAccessService::with_membership(USER_ID, TeamRole::Member),
    )
    .oneshot(
        Request::get("/invites")
            .header(header::AUTHORIZATION, "Bearer valid")
            .body(Body::empty())
            .expect("request should be valid"),
    )
    .await
    .expect("router should respond");

    assert_eq!(member_response.status(), StatusCode::UNAUTHORIZED);
    assert!(member_service.team_receipt_calls().is_empty());
}

#[tokio::test]
async fn premium_user_authorization_rejection_preserves_response() {
    let rejection = PremiumUserRejection::Authorization(MacroAuthorizationRejection {
        status: StatusCode::FORBIDDEN,
        message: "authorization denied".into(),
    });
    let (status, body, _) = response_parts(rejection).await;

    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(body, r#"{"message":"authorization denied"}"#);
}
