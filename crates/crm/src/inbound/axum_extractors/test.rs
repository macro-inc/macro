use entity_access::domain::models::TeamRole;
use std::sync::{Arc, Mutex};

use axum::{
    Json, Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
    routing::get,
};
use chrono::{DateTime, Utc};
use entity_access::domain::{
    models::{
        AccessError, AccessLevel, AnyEntityPermission, BotAccessScope, BotId, CallChannelInfo,
        EditAccessLevel, EntityAccessReceipt, EntityPermission, EntityType, MemberTeamRole,
        RequiredPermission, UserTeamInfo, ViewAccessLevel,
    },
    ports::EntityAccessService,
};
use macro_authorization::{
    INTERNAL_API_KEY_HEADER, INTERNAL_MACRO_USER_ID_HEADER, InternalAuthConfig, JwtValidator,
    MacroAuthorizationError, MacroAuthorizationServiceImpl, MacroAuthorizationState,
    ValidatedIdentity,
};
use macro_user_id::{
    lowercased::Lowercase,
    user_id::{MacroUserId, MacroUserIdStr},
};
use rootcause::Report;
use serde_json::{Value, json};
use tower::ServiceExt;
use uuid::Uuid;

use super::{
    CrmCommentAccessLevelExtractor, CrmCompanyAccessLevelExtractor, CrmContactAccessLevelExtractor,
};
use crate::{
    domain::{
        auth::{CrmCommentReceipt, CrmCompanyReceipt, CrmContactReceipt, CrmTeamReceipt},
        comment::{CrmComment, CrmCommentEntityType, CrmCommentThread, DeleteCrmCommentResult},
        companies_repo::{CrmCompanyListSort, CrmCompanySoupCursor},
        model::{
            CrmCompanyForSoup, CrmCompanyWithContacts, CrmContact, CrmError, CrmScopePrecheck,
        },
        service::CrmService,
    },
    inbound::axum_router::CrmRouterState,
};

const USER_ID: &str = "macro|user@example.com";
const INTERNAL_USER_ID: &str = "macro|acting@example.com";
const VALID_TOKEN: &str = "valid";
const INTERNAL_KEY: &str = "valid-internal-key";
const COMPANY_ID: &str = "11111111-1111-4111-8111-111111111111";
const CONTACT_ID: &str = "22222222-2222-4222-8222-222222222222";
const COMMENT_ID: &str = "33333333-3333-4333-8333-333333333333";
const PARENT_ID: &str = "44444444-4444-4444-8444-444444444444";
const TEAM_ID: &str = "55555555-5555-4555-8555-555555555555";

#[derive(Clone, Default)]
struct FakeJwtValidator;

impl JwtValidator for FakeJwtValidator {
    fn validate(&self, jwt: &str) -> Result<ValidatedIdentity, Report<MacroAuthorizationError>> {
        match jwt {
            VALID_TOKEN => Ok(ValidatedIdentity {
                user_id: USER_ID.to_string(),
                fusion_user_id: "test-fusion-user".to_string(),
                organization_id: None,
                permissions: None,
            }),
            "expired" => Err(Report::new(MacroAuthorizationError::CredentialsExpired)),
            _ => Err(Report::new(MacroAuthorizationError::InvalidCredentials)),
        }
    }
}

type TestAuthorizationService = MacroAuthorizationServiceImpl<FakeJwtValidator>;

#[derive(Clone, Copy)]
enum PermissionResult {
    Allowed(EntityPermission),
    Unauthorized,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct EntityAccessCall {
    user_id: Option<String>,
    entity_id: String,
    entity_type: EntityType,
}

#[derive(Clone)]
struct FakeEntityAccessService {
    result: PermissionResult,
    calls: Arc<Mutex<Vec<EntityAccessCall>>>,
}

impl FakeEntityAccessService {
    fn with_access_level(access_level: AccessLevel) -> Self {
        Self {
            result: PermissionResult::Allowed(EntityPermission::AccessLevel { access_level }),
            calls: Arc::new(Mutex::new(Vec::new())),
        }
    }

    fn unauthorized() -> Self {
        Self {
            result: PermissionResult::Unauthorized,
            calls: Arc::new(Mutex::new(Vec::new())),
        }
    }

    fn calls(&self) -> Vec<EntityAccessCall> {
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
        _scope: BotAccessScope,
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
        _organization_id: Option<i64>,
    ) -> Result<EntityPermission, AccessError> {
        panic!("unexpected get_entity_permission call")
    }

    async fn get_crm_entity_permission_with_team(
        &self,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<(EntityPermission, Uuid, TeamRole), AccessError> {
        self.calls
            .lock()
            .expect("calls lock poisoned")
            .push(EntityAccessCall {
                user_id: user_id.map(|user_id| user_id.as_ref().to_string()),
                entity_id: entity_id.to_string(),
                entity_type,
            });

        match self.result {
            // Pair the permission with the team role that would have
            // produced it (owner → Owner, edit → Admin, else Member).
            PermissionResult::Allowed(permission) => {
                let team_role = if permission.allows_access_level(AccessLevel::Owner) {
                    TeamRole::Owner
                } else if permission.allows_access_level(AccessLevel::Edit) {
                    TeamRole::Admin
                } else {
                    TeamRole::Member
                };
                Ok((permission, uuid(TEAM_ID), team_role))
            }
            PermissionResult::Unauthorized => Err(AccessError::Unauthorized),
        }
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

#[derive(Clone)]
struct FakeCrmService {
    comment_entity: Option<(CrmCommentEntityType, Uuid)>,
    comment_calls: Arc<Mutex<Vec<Uuid>>>,
}

impl FakeCrmService {
    fn new(comment_entity: Option<(CrmCommentEntityType, Uuid)>) -> Self {
        Self {
            comment_entity,
            comment_calls: Arc::new(Mutex::new(Vec::new())),
        }
    }

    fn comment_calls(&self) -> Vec<Uuid> {
        self.comment_calls
            .lock()
            .expect("comment calls lock poisoned")
            .clone()
    }
}

impl CrmService for FakeCrmService {
    async fn populate_contact(
        &self,
        _team_id: &Uuid,
        _link_id: &Uuid,
        _user_email: &str,
        _email: &str,
        _name: Option<&str>,
        _first_at: DateTime<Utc>,
        _last_at: DateTime<Utc>,
        _is_sent: bool,
    ) -> Result<(), CrmError> {
        panic!("unexpected populate_contact call")
    }

    async fn depopulate_contact(
        &self,
        _team_id: &Uuid,
        _link_id: &Uuid,
        _email: &str,
    ) -> Result<(), CrmError> {
        panic!("unexpected depopulate_contact call")
    }

    async fn depopulate_link_in_team(
        &self,
        _team_id: &Uuid,
        _link_id: &Uuid,
    ) -> Result<(), CrmError> {
        panic!("unexpected depopulate_link_in_team call")
    }

    async fn get_team_id_for_user(&self, _macro_id: &str) -> Result<Option<Uuid>, CrmError> {
        panic!("unexpected get_team_id_for_user call")
    }

    async fn create_company(
        &self,
        _access: &CrmTeamReceipt<MemberTeamRole>,
        _name: &str,
        _domain: &str,
    ) -> Result<CrmCompanyWithContacts, CrmError> {
        panic!("unexpected create_company call")
    }

    async fn create_contact(
        &self,
        _access: &CrmCompanyReceipt<ViewAccessLevel>,
        _name: &str,
        _email: &str,
    ) -> Result<CrmContact, CrmError> {
        panic!("unexpected create_contact call")
    }

    async fn set_email_sync(
        &self,
        _access: &CrmCompanyReceipt<EditAccessLevel>,
        _email_sync: bool,
    ) -> Result<(), CrmError> {
        panic!("unexpected set_email_sync call")
    }

    async fn set_company_hidden(
        &self,
        _access: &CrmCompanyReceipt<EditAccessLevel>,
        _hidden: bool,
    ) -> Result<(), CrmError> {
        panic!("unexpected set_company_hidden call")
    }

    async fn set_company_name(
        &self,
        _access: &CrmCompanyReceipt<ViewAccessLevel>,
        _name: &str,
    ) -> Result<(), CrmError> {
        panic!("unexpected set_company_name call")
    }

    async fn set_contact_name(
        &self,
        _access: &CrmContactReceipt<ViewAccessLevel>,
        _name: &str,
    ) -> Result<(), CrmError> {
        panic!("unexpected set_contact_name call")
    }

    async fn set_contact_hidden(
        &self,
        _access: &CrmContactReceipt<EditAccessLevel>,
        _hidden: bool,
    ) -> Result<(), CrmError> {
        panic!("unexpected set_contact_hidden call")
    }

    async fn crm_scope_precheck(
        &self,
        _team_id: &Uuid,
        _domains: &[String],
        _addresses: &[String],
    ) -> Result<CrmScopePrecheck, CrmError> {
        panic!("unexpected crm_scope_precheck call")
    }

    async fn list_companies_for_soup(
        &self,
        _access: &CrmTeamReceipt<MemberTeamRole>,
        _user_id: &str,
        _company_ids: &[Uuid],
        _hidden: Option<bool>,
        _sort: CrmCompanyListSort,
        _cursor: Option<CrmCompanySoupCursor>,
        _limit: i64,
    ) -> Result<Vec<CrmCompanyForSoup>, CrmError> {
        panic!("unexpected list_companies_for_soup call")
    }

    async fn list_contacts_for_company(
        &self,
        _access: &CrmCompanyReceipt<ViewAccessLevel>,
    ) -> Result<Vec<CrmContact>, CrmError> {
        panic!("unexpected list_contacts_for_company call")
    }

    async fn get_contact_for_team(
        &self,
        _access: &CrmContactReceipt<ViewAccessLevel>,
    ) -> Result<Option<CrmContact>, CrmError> {
        panic!("unexpected get_contact_for_team call")
    }

    async fn get_company_for_team(
        &self,
        _access: &CrmCompanyReceipt<ViewAccessLevel>,
    ) -> Result<Option<CrmCompanyWithContacts>, CrmError> {
        panic!("unexpected get_company_for_team call")
    }

    async fn create_crm_comment(
        &self,
        _access: &CrmCommentReceipt<AnyEntityPermission>,
        _owner: &str,
        _thread_id: Option<Uuid>,
        _thread_metadata: Option<Value>,
        _text: &str,
        _metadata: Option<Value>,
    ) -> Result<CrmCommentThread, CrmError> {
        panic!("unexpected create_crm_comment call")
    }

    async fn get_crm_comment_threads(
        &self,
        _access: &CrmCommentReceipt<AnyEntityPermission>,
    ) -> Result<Vec<CrmCommentThread>, CrmError> {
        panic!("unexpected get_crm_comment_threads call")
    }

    async fn edit_crm_comment(
        &self,
        _access: &CrmCommentReceipt<ViewAccessLevel>,
        _comment_id: &Uuid,
        _text: &str,
    ) -> Result<CrmComment, CrmError> {
        panic!("unexpected edit_crm_comment call")
    }

    async fn delete_crm_comment(
        &self,
        _access: &CrmCommentReceipt<ViewAccessLevel>,
        _comment_id: &Uuid,
    ) -> Result<DeleteCrmCommentResult, CrmError> {
        panic!("unexpected delete_crm_comment call")
    }

    async fn get_comment_entity(
        &self,
        comment_id: &Uuid,
    ) -> Result<Option<(CrmCommentEntityType, Uuid)>, CrmError> {
        self.comment_calls
            .lock()
            .expect("comment calls lock poisoned")
            .push(*comment_id);
        Ok(self.comment_entity)
    }

    async fn get_team_settings(
        &self,
        _access: &CrmTeamReceipt<MemberTeamRole>,
    ) -> Result<crate::domain::model::CrmTeamSettings, CrmError> {
        panic!("unexpected get_team_settings call")
    }

    async fn update_team_settings(
        &self,
        _access: &CrmTeamReceipt<MemberTeamRole>,
        _patch: crate::domain::model::CrmTeamSettingsPatch,
    ) -> Result<crate::domain::model::CrmTeamSettings, CrmError> {
        panic!("unexpected update_team_settings call")
    }
}

async fn company_handler(
    extractor: CrmCompanyAccessLevelExtractor<
        EditAccessLevel,
        FakeEntityAccessService,
        TestAuthorizationService,
    >,
) -> Json<Value> {
    receipt_response(extractor.receipt.receipt(), extractor.receipt.team_id())
}

async fn contact_handler(
    extractor: CrmContactAccessLevelExtractor<
        EditAccessLevel,
        FakeEntityAccessService,
        TestAuthorizationService,
    >,
) -> Json<Value> {
    receipt_response(extractor.receipt.receipt(), extractor.receipt.team_id())
}

async fn comment_handler(
    extractor: CrmCommentAccessLevelExtractor<
        EditAccessLevel,
        FakeCrmService,
        FakeEntityAccessService,
        TestAuthorizationService,
    >,
) -> Json<Value> {
    receipt_response(extractor.receipt.receipt(), extractor.receipt.team_id())
}

fn receipt_response<T: RequiredPermission>(
    receipt: &EntityAccessReceipt<T>,
    team_id: Uuid,
) -> Json<Value> {
    Json(json!({
        "user_id": receipt
            .get_authenticated_user()
            .expect("CRM extractors require an authenticated user")
            .to_string(),
        "entity_id": receipt.entity().entity_id,
        "entity_type": receipt.entity().entity_type.to_string(),
        "permission": receipt.entity_permission(),
        "team_id": team_id,
    }))
}

fn test_router(
    entity_access: FakeEntityAccessService,
    comment_entity: Option<(CrmCommentEntityType, Uuid)>,
) -> (Router, FakeEntityAccessService, FakeCrmService) {
    let crm_service = FakeCrmService::new(comment_entity);
    let authorization_service = MacroAuthorizationServiceImpl::new(
        FakeJwtValidator,
        InternalAuthConfig {
            api_key: INTERNAL_KEY.to_string(),
            default_user_id: None,
        },
        macro_authorization::NoBotAuthorizer,
    );
    let state: CrmRouterState<FakeCrmService, FakeEntityAccessService, TestAuthorizationService> =
        CrmRouterState {
            service: Arc::new(crm_service.clone()),
            entity_access_service: Arc::new(entity_access.clone()),
            authorization_state: MacroAuthorizationState::new(Arc::new(authorization_service)),
        };
    let router = Router::new()
        .route("/companies/{company_id}", get(company_handler))
        .route("/company-without-id/{other_id}", get(company_handler))
        .route("/contacts/{contact_id}", get(contact_handler))
        .route("/contact-without-id/{other_id}", get(contact_handler))
        .route("/comments/{comment_id}", get(comment_handler))
        .with_state(state);

    (router, entity_access, crm_service)
}

fn uuid(value: &str) -> Uuid {
    Uuid::parse_str(value).expect("test UUID should be valid")
}

fn bearer_request(path: &str, token: &str) -> Request<Body> {
    Request::get(path)
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap()
}

fn internal_request(path: &str, acting_user: Option<&str>) -> Request<Body> {
    let mut request = Request::get(path).header(INTERNAL_API_KEY_HEADER, INTERNAL_KEY);
    if let Some(acting_user) = acting_user {
        request = request.header(INTERNAL_MACRO_USER_ID_HEADER, acting_user);
    }
    request.body(Body::empty()).unwrap()
}

async fn send(router: &Router, request: Request<Body>) -> (StatusCode, Value) {
    let response = router.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let body = serde_json::from_slice(&body).expect("response should contain JSON");
    (status, body)
}

#[tokio::test]
async fn valid_company_and_contact_receipts_contain_the_entity_and_owning_team() {
    let access = FakeEntityAccessService::with_access_level(AccessLevel::Edit);
    let (router, access, _crm) = test_router(access, None);

    for (path, expected_id, expected_type) in [
        (
            format!("/companies/{COMPANY_ID}"),
            COMPANY_ID,
            EntityType::CrmCompany,
        ),
        (
            format!("/contacts/{CONTACT_ID}"),
            CONTACT_ID,
            EntityType::CrmContact,
        ),
    ] {
        let (status, body) = send(&router, bearer_request(&path, VALID_TOKEN)).await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["user_id"], USER_ID);
        assert_eq!(body["entity_id"], expected_id);
        assert_eq!(body["entity_type"], expected_type.to_string());
        assert_eq!(body["permission"]["access_level"], "edit");
        assert_eq!(body["team_id"], TEAM_ID);
    }

    assert_eq!(
        access.calls(),
        [
            EntityAccessCall {
                user_id: Some(USER_ID.to_string()),
                entity_id: COMPANY_ID.to_string(),
                entity_type: EntityType::CrmCompany,
            },
            EntityAccessCall {
                user_id: Some(USER_ID.to_string()),
                entity_id: CONTACT_ID.to_string(),
                entity_type: EntityType::CrmContact,
            },
        ]
    );
}

#[tokio::test]
async fn insufficient_company_and_contact_permissions_return_unauthorized() {
    let access = FakeEntityAccessService::with_access_level(AccessLevel::View);
    let (router, access, _crm) = test_router(access, None);

    for path in [
        format!("/companies/{COMPANY_ID}"),
        format!("/contacts/{CONTACT_ID}"),
    ] {
        let (status, _body) = send(&router, bearer_request(&path, VALID_TOKEN)).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    assert_eq!(access.calls().len(), 2);
}

#[tokio::test]
async fn malformed_and_missing_company_and_contact_ids_return_bad_request() {
    let access = FakeEntityAccessService::with_access_level(AccessLevel::Edit);
    let (router, access, _crm) = test_router(access, None);
    let cases = [
        (
            "/companies/not-a-uuid",
            "Bad request: invalid CRM company ID format",
        ),
        (
            "/company-without-id/value",
            "Bad request: missing company_id path parameter",
        ),
        (
            "/contacts/not-a-uuid",
            "Bad request: invalid CRM contact ID format",
        ),
        (
            "/contact-without-id/value",
            "Bad request: missing contact_id path parameter",
        ),
    ];

    for (path, expected_message) in cases {
        let request = Request::get(path).body(Body::empty()).unwrap();
        let (status, body) = send(&router, request).await;

        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(body, json!({ "message": expected_message }));
    }

    assert!(access.calls().is_empty());
}

#[tokio::test]
async fn internal_company_and_contact_requests_check_access_as_the_acting_user() {
    let access = FakeEntityAccessService::with_access_level(AccessLevel::Edit);
    let (router, access, _crm) = test_router(access, None);

    for path in [
        format!("/companies/{COMPANY_ID}"),
        format!("/contacts/{CONTACT_ID}"),
    ] {
        let (status, body) = send(&router, internal_request(&path, Some(INTERNAL_USER_ID))).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["user_id"], INTERNAL_USER_ID);
    }

    assert_eq!(
        access.calls(),
        [
            EntityAccessCall {
                user_id: Some(INTERNAL_USER_ID.to_string()),
                entity_id: COMPANY_ID.to_string(),
                entity_type: EntityType::CrmCompany,
            },
            EntityAccessCall {
                user_id: Some(INTERNAL_USER_ID.to_string()),
                entity_id: CONTACT_ID.to_string(),
                entity_type: EntityType::CrmContact,
            },
        ]
    );
}

#[tokio::test]
async fn credential_failures_happen_before_permission_lookup() {
    enum Credentials {
        Missing,
        Bearer(&'static str),
        IdentityLessInternal,
    }

    let cases = [
        (Credentials::Missing, "unauthorized"),
        (Credentials::Bearer("invalid"), "unauthorized"),
        (Credentials::Bearer("expired"), "jwt expired"),
        (Credentials::IdentityLessInternal, "unauthorized"),
    ];

    for (credentials, expected_message) in cases {
        let access = FakeEntityAccessService::with_access_level(AccessLevel::Edit);
        let (router, access, _crm) = test_router(access, None);
        let path = format!("/companies/{COMPANY_ID}");
        let request = match credentials {
            Credentials::Missing => Request::get(path).body(Body::empty()).unwrap(),
            Credentials::Bearer(token) => bearer_request(&path, token),
            Credentials::IdentityLessInternal => internal_request(&path, None),
        };

        let (status, body) = send(&router, request).await;

        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(body, json!({ "message": expected_message }));
        assert!(access.calls().is_empty());
    }
}

#[tokio::test]
async fn comment_receipt_resolves_its_parent_entity_and_team() {
    let access = FakeEntityAccessService::with_access_level(AccessLevel::Edit);
    let comment_entity = Some((CrmCommentEntityType::CrmContact, uuid(PARENT_ID)));
    let (router, access, crm) = test_router(access, comment_entity);

    let (status, body) = send(
        &router,
        bearer_request(&format!("/comments/{COMMENT_ID}"), VALID_TOKEN),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["entity_id"], PARENT_ID);
    assert_eq!(body["entity_type"], EntityType::CrmContact.to_string());
    assert_eq!(body["team_id"], TEAM_ID);
    assert_eq!(crm.comment_calls(), [uuid(COMMENT_ID)]);
    assert_eq!(
        access.calls(),
        [EntityAccessCall {
            user_id: Some(USER_ID.to_string()),
            entity_id: PARENT_ID.to_string(),
            entity_type: EntityType::CrmContact,
        }]
    );
}

#[tokio::test]
async fn missing_comment_preserves_not_found_anti_oracle_response() {
    let access = FakeEntityAccessService::with_access_level(AccessLevel::Edit);
    let (router, access, crm) = test_router(access, None);

    let (status, body) = send(
        &router,
        bearer_request(&format!("/comments/{COMMENT_ID}"), VALID_TOKEN),
    )
    .await;

    assert_comment_not_found(status, body);
    assert_eq!(crm.comment_calls(), [uuid(COMMENT_ID)]);
    assert!(access.calls().is_empty());
}

#[tokio::test]
async fn denied_comment_parent_access_preserves_not_found_anti_oracle_response() {
    let access = FakeEntityAccessService::unauthorized();
    let comment_entity = Some((CrmCommentEntityType::CrmCompany, uuid(PARENT_ID)));
    let (router, access, _crm) = test_router(access, comment_entity);

    let (status, body) = send(
        &router,
        bearer_request(&format!("/comments/{COMMENT_ID}"), VALID_TOKEN),
    )
    .await;

    assert_comment_not_found(status, body);
    assert_eq!(access.calls().len(), 1);
}

#[tokio::test]
async fn insufficient_comment_permission_preserves_not_found_anti_oracle_response() {
    let access = FakeEntityAccessService::with_access_level(AccessLevel::View);
    let comment_entity = Some((CrmCommentEntityType::CrmCompany, uuid(PARENT_ID)));
    let (router, access, _crm) = test_router(access, comment_entity);

    let (status, body) = send(
        &router,
        bearer_request(&format!("/comments/{COMMENT_ID}"), VALID_TOKEN),
    )
    .await;

    assert_comment_not_found(status, body);
    assert_eq!(access.calls().len(), 1);
}

fn assert_comment_not_found(status: StatusCode, body: Value) {
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(
        body,
        json!({ "message": "Not found: CRM comment not found" })
    );
}
