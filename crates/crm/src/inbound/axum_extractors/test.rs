use entity_access::domain::models::TeamRole;
use std::sync::{Arc, Mutex};

use axum::{
    Json, Router,
    body::{Body, to_bytes},
    http::{Method, Request, StatusCode, header},
    routing::get,
};
use chrono::{DateTime, Utc};
use entity_access::domain::{
    models::{
        AccessError, AccessLevel, BotAccessScope, BotId, CallChannelInfo, EditAccessLevel,
        EntityAccessReceipt, EntityPermission, EntityType, MemberTeamRole, RequiredPermission,
        UserTeamInfo, ViewAccessLevel,
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

use super::{CrmCompanyAccessLevelExtractor, CrmContactAccessLevelExtractor};
use crate::{
    domain::{
        auth::{CrmCompanyReceipt, CrmContactReceipt, CrmTeamReceipt},
        companies_repo::{CrmCompanyListSort, CrmCompanySoupCursor},
        model::{
            CrmCompanyForSoup, CrmCompanyWithContacts, CrmContact, CrmError, CrmScopePrecheck,
            DepopulateContactOutcome,
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
const TEAM_ID: &str = "55555555-5555-4555-8555-555555555555";

#[derive(Clone, Default)]
struct FakeJwtValidator;

impl JwtValidator for FakeJwtValidator {
    fn validate_credential(
        &self,
        jwt: &str,
    ) -> Result<macro_authorization::ValidatedCredential, Report<MacroAuthorizationError>> {
        match jwt {
            VALID_TOKEN => Ok(macro_authorization::ValidatedCredential {
                origin: macro_authorization::CredentialOrigin::Session,
                identity: ValidatedIdentity {
                    agent_id: None,
                    agent_via: None,
                    user_id: USER_ID.to_string(),
                    fusion_user_id: "test-fusion-user".to_string(),
                    organization_id: None,
                    permissions: None,
                },
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
struct FakeCrmService;

impl crate::domain::email_privacy::EmailPrivacyService for FakeCrmService {
    async fn contribution_mailbox(
        &self,
        _: Uuid,
        _: &str,
    ) -> Result<Option<crate::domain::email_privacy::EmailContributionMailbox>, CrmError> {
        panic!("unexpected contribution_mailbox call")
    }

    async fn email_privacy(
        &self,
        _: &CrmTeamReceipt<MemberTeamRole>,
    ) -> Result<crate::domain::email_privacy::EmailPrivacySettings, CrmError> {
        panic!("unexpected email_privacy call")
    }

    async fn change_email_privacy(
        &self,
        _: &CrmTeamReceipt<MemberTeamRole>,
        _: crate::domain::email_privacy::EmailPrivacyChange,
    ) -> Result<crate::domain::email_privacy::EmailPrivacySettings, CrmError> {
        panic!("unexpected change_email_privacy call")
    }
}

impl CrmService for FakeCrmService {
    async fn list_contacts_for_soup(
        &self,
        _user_id: &str,
        _access: Option<
            &crate::domain::auth::CrmTeamReceipt<entity_access::domain::models::MemberTeamRole>,
        >,
        _query: crate::domain::contact_listing::CrmContactListQuery,
    ) -> Result<Vec<crate::domain::contact_listing::CrmContactForSoup>, CrmError> {
        Ok(vec![])
    }

    async fn resolve_association(
        &self,
        _user_id: &str,
        _access: Option<
            &crate::domain::auth::CrmTeamReceipt<entity_access::domain::models::MemberTeamRole>,
        >,
        _record: crate::domain::association::CrmAssociation,
    ) -> Result<crate::domain::association::CrmRecordAssociation, CrmError> {
        panic!("unexpected resolve_association call")
    }

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
    ) -> Result<DepopulateContactOutcome, CrmError> {
        panic!("unexpected depopulate_contact call")
    }

    async fn has_depopulate_target(&self, _team_id: &Uuid, _email: &str) -> Result<bool, CrmError> {
        panic!("unexpected has_depopulate_target call")
    }

    async fn link_contact_pairs_with_sources(
        &self,
        _pairs: &[(Uuid, String)],
    ) -> Result<Vec<(Uuid, String)>, CrmError> {
        panic!("unexpected link_contact_pairs_with_sources call")
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
        _domain: Option<&str>,
    ) -> Result<CrmCompanyWithContacts, CrmError> {
        panic!("unexpected create_company call")
    }

    async fn create_contact(
        &self,
        _access: &CrmCompanyReceipt<ViewAccessLevel>,
        _name: &str,
        _email: Option<&str>,
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

    async fn set_contact_email(
        &self,
        _access: &crate::domain::auth::CrmContactReceipt<
            entity_access::domain::models::EditAccessLevel,
        >,
        _email: &str,
    ) -> Result<crate::domain::model::CrmContact, CrmError> {
        Err(CrmError::ContactNotFoundForTeam)
    }

    async fn set_contact_company(
        &self,
        _access: &crate::domain::auth::CrmContactReceipt<
            entity_access::domain::models::EditAccessLevel,
        >,
        _company_id: uuid::Uuid,
    ) -> Result<crate::domain::model::CrmContact, CrmError> {
        Err(CrmError::ContactNotFoundForTeam)
    }

    async fn add_contact_email(
        &self,
        _access: &crate::domain::auth::CrmContactReceipt<
            entity_access::domain::models::EditAccessLevel,
        >,
        _email: &str,
    ) -> Result<crate::domain::model::CrmContact, CrmError> {
        Err(CrmError::ContactNotFoundForTeam)
    }

    async fn remove_contact_email(
        &self,
        _access: &crate::domain::auth::CrmContactReceipt<
            entity_access::domain::models::EditAccessLevel,
        >,
        _email: &str,
    ) -> Result<crate::domain::model::CrmContact, CrmError> {
        Err(CrmError::ContactNotFoundForTeam)
    }

    async fn unlink_contact_company(
        &self,
        _access: &crate::domain::auth::CrmContactReceipt<
            entity_access::domain::models::EditAccessLevel,
        >,
    ) -> Result<crate::domain::model::CrmContact, CrmError> {
        Err(CrmError::ContactNotFoundForTeam)
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

    async fn search_contacts(
        &self,
        _access: &CrmTeamReceipt<MemberTeamRole>,
        _query: &str,
        _limit: u16,
    ) -> Result<Vec<CrmContact>, CrmError> {
        panic!("unexpected search_contacts call")
    }

    async fn get_contact_by_email(
        &self,
        _access: &CrmTeamReceipt<MemberTeamRole>,
        _email: &str,
    ) -> Result<Option<CrmContact>, CrmError> {
        panic!("unexpected get_contact_by_email call")
    }

    async fn get_company_for_team(
        &self,
        _access: &CrmCompanyReceipt<ViewAccessLevel>,
    ) -> Result<Option<CrmCompanyWithContacts>, CrmError> {
        panic!("unexpected get_company_for_team call")
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

    async fn create_team_contact(
        &self,
        _access: &CrmTeamReceipt<MemberTeamRole>,
        _name: &str,
        _email: Option<&str>,
    ) -> Result<CrmContact, CrmError> {
        panic!("unexpected create_team_contact call")
    }

    async fn list_blocked_domains(
        &self,
        _access: &CrmTeamReceipt<MemberTeamRole>,
    ) -> Result<Vec<crate::domain::model::CrmBlockedDomain>, CrmError> {
        panic!("unexpected list_blocked_domains call")
    }

    async fn set_domain_blocked(
        &self,
        _access: &CrmTeamReceipt<MemberTeamRole>,
        _domain: &str,
        _blocked: bool,
    ) -> Result<String, CrmError> {
        panic!("unexpected set_domain_blocked call")
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
) -> (Router, FakeEntityAccessService, FakeCrmService) {
    let crm_service = FakeCrmService;
    let authorization_service = MacroAuthorizationServiceImpl::new(
        FakeJwtValidator,
        InternalAuthConfig {
            api_key: INTERNAL_KEY.to_string(),
            default_user_id: None,
        },
        macro_authorization::NoBotAuthorizer,
        macro_authorization::NoUserApiKeyAuthorizer,
    );
    let state: CrmRouterState<
        FakeCrmService,
        (),
        FakeEntityAccessService,
        TestAuthorizationService,
    > = CrmRouterState {
        service: Arc::new(crm_service.clone()),
        stage_service: Arc::new(()),
        entity_access_service: Arc::new(entity_access.clone()),
        authorization_state: MacroAuthorizationState::new(Arc::new(authorization_service)),
    };
    let router = Router::new()
        .route("/companies/{company_id}", get(company_handler))
        .route("/company-without-id/{other_id}", get(company_handler))
        .route("/contacts/{contact_id}", get(contact_handler))
        .route("/contact-without-id/{other_id}", get(contact_handler))
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
    let (router, access, _crm) = test_router(access);

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
    let (router, access, _crm) = test_router(access);

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
    let (router, access, _crm) = test_router(access);
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
    let (router, access, _crm) = test_router(access);

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
        let (router, access, _crm) = test_router(access);
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

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn contact_mutation_http_contract_covers_addresses_and_company_links(
    pool: sqlx::PgPool,
) -> anyhow::Result<()> {
    use crate::domain::{companies_repo::CompaniesRepository, service::CrmServiceImpl};
    use crate::inbound::axum_router::{contact_emails, set_contact_company, set_contact_email};
    use crate::outbound::{
        companies_repo::CompaniesRepositoryImpl, no_op_resolver::NoOpCompanyMetadataResolver,
    };
    let team = uuid(TEAM_ID);
    let user = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $3)",
        user,
        USER_ID,
        format!("stripe_{user}")
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        "INSERT INTO \"User\" (id, email, macro_user_id) VALUES ($1, $1, $2)",
        USER_ID,
        user
    )
    .execute(&pool)
    .await?;
    sqlx::query!(
        "INSERT INTO team (id, name, owner_id) VALUES ($1, 'Test team', $2)",
        team,
        USER_ID
    )
    .execute(&pool)
    .await?;
    // Manual contact edits need team access, never contribution enrollment.
    let repo = CompaniesRepositoryImpl::new(pool.clone());
    let contact = repo
        .create_contact_for_team(&team, None, "Contact", Utc::now())
        .await?;
    let company = repo
        .create_company_for_team(&team, None, "Example company", Utc::now())
        .await?;
    let service = Arc::new(CrmServiceImpl::new(
        repo.clone(),
        NoOpCompanyMetadataResolver,
    ));
    let router = |level| {
        let authorization = MacroAuthorizationServiceImpl::new(
            FakeJwtValidator,
            InternalAuthConfig {
                api_key: INTERNAL_KEY.to_string(),
                default_user_id: None,
            },
            macro_authorization::NoBotAuthorizer,
            macro_authorization::NoUserApiKeyAuthorizer,
        );
        Router::new()
            .route(
                "/contacts/{contact_id}/email",
                axum::routing::put(set_contact_email::handler),
            )
            .route(
                "/contacts/{contact_id}/emails",
                axum::routing::put(contact_emails::add_handler)
                    .delete(contact_emails::remove_handler),
            )
            .route(
                "/contacts/{contact_id}/company",
                axum::routing::put(set_contact_company::handler)
                    .delete(set_contact_company::unlink_handler),
            )
            .with_state(CrmRouterState {
                service: service.clone(),
                stage_service: Arc::new(()),
                entity_access_service: Arc::new(FakeEntityAccessService::with_access_level(level)),
                authorization_state: MacroAuthorizationState::new(Arc::new(authorization)),
            })
    };
    let edit = router(AccessLevel::Edit);
    let request = |id: Uuid, field: &str, body: Value| {
        Request::put(format!("/contacts/{id}/{field}"))
            .header(header::AUTHORIZATION, format!("Bearer {VALID_TOKEN}"))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body.to_string()))
            .unwrap()
    };
    for (field, body) in [
        ("email", json!({})),
        ("email", json!({"email": null})),
        ("company", json!({})),
        ("company", json!({"companyId": null})),
    ] {
        assert_eq!(
            edit.clone()
                .oneshot(request(contact.id, field, body))
                .await?
                .status(),
            StatusCode::UNPROCESSABLE_ENTITY
        );
    }
    assert_eq!(
        edit.clone()
            .oneshot(request(
                contact.id,
                "company",
                json!({"companyId": company.company.id})
            ))
            .await?
            .status(),
        StatusCode::BAD_REQUEST
    );
    assert_eq!(
        router(AccessLevel::View)
            .oneshot(request(
                contact.id,
                "email",
                json!({"email": "contact@example.com"})
            ))
            .await?
            .status(),
        StatusCode::UNAUTHORIZED
    );
    for _ in 0..2 {
        assert_eq!(
            edit.clone()
                .oneshot(request(
                    contact.id,
                    "email",
                    json!({"email": " Contact@Example.com "})
                ))
                .await?
                .status(),
            StatusCode::OK
        );
    }
    // Addresses travel in the body, so request telemetry never records one.
    // Adding needs edit access like every other contact setter.
    let address = |method: Method, id: Uuid, email: &str| {
        Request::builder()
            .method(method)
            .uri(format!("/contacts/{id}/emails"))
            .header(header::AUTHORIZATION, format!("Bearer {VALID_TOKEN}"))
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(json!({ "email": email }).to_string()))
            .unwrap()
    };
    assert_eq!(
        router(AccessLevel::View)
            .oneshot(address(Method::PUT, contact.id, "second@example.com"))
            .await?
            .status(),
        StatusCode::UNAUTHORIZED
    );
    let response = edit
        .clone()
        .oneshot(address(Method::PUT, contact.id, "Second+tag@Example.com"))
        .await?;
    assert_eq!(response.status(), StatusCode::OK);
    let body: Value = serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await?)?;
    assert_eq!(body["email"], "contact@example.com");
    assert_eq!(
        body["emails"],
        json!(["contact@example.com", "second+tag@example.com"])
    );
    assert_eq!(body["companyDomain"], false);
    assert_eq!(body["companyDomainEmails"], json!([]));
    assert_eq!(
        edit.clone()
            .oneshot(address(Method::PUT, contact.id, "not-an-address"))
            .await?
            .status(),
        StatusCode::BAD_REQUEST
    );
    let response = edit
        .clone()
        .oneshot(address(
            Method::DELETE,
            contact.id,
            "second+tag@example.com",
        ))
        .await?;
    assert_eq!(response.status(), StatusCode::OK);
    let body: Value = serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await?)?;
    assert_eq!(body["emails"], json!(["contact@example.com"]));
    assert_eq!(
        router(AccessLevel::View)
            .oneshot(address(Method::DELETE, contact.id, "contact@example.com"))
            .await?
            .status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        edit.clone()
            .oneshot(request(
                contact.id,
                "company",
                json!({"companyId": company.company.id})
            ))
            .await?
            .status(),
        StatusCode::BAD_REQUEST
    );
    let persisted = repo
        .get_contact_for_team(&team, &contact.id, true)
        .await?
        .unwrap();
    assert_eq!(persisted.email.as_deref(), Some("contact@example.com"));
    assert_eq!(persisted.company_id, None);
    let blank = repo
        .create_contact_for_team(&team, None, "Second", Utc::now())
        .await?;
    assert_eq!(
        edit.clone()
            .oneshot(request(
                blank.id,
                "email",
                json!({"email": "contact@example.com"})
            ))
            .await?
            .status(),
        StatusCode::CONFLICT
    );
    let personal = format!("contact@{}", "gmail.com");
    assert_eq!(
        edit.clone()
            .oneshot(request(blank.id, "email", json!({"email": personal})))
            .await?
            .status(),
        StatusCode::OK
    );
    let response = edit
        .clone()
        .oneshot(request(
            blank.id,
            "company",
            json!({"companyId": company.company.id}),
        ))
        .await?;
    assert_eq!(response.status(), StatusCode::OK);
    let body: Value = serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await?)?;
    assert_eq!(body["personalEmail"], true);
    assert_eq!(body["companyId"], company.company.id.to_string());

    let unlink = |level| {
        router(level).oneshot(
            Request::delete(format!("/contacts/{}/company", blank.id))
                .header(header::AUTHORIZATION, format!("Bearer {VALID_TOKEN}"))
                .body(Body::empty())
                .unwrap(),
        )
    };
    assert_eq!(
        unlink(AccessLevel::View).await?.status(),
        StatusCode::UNAUTHORIZED
    );
    let response = unlink(AccessLevel::Edit).await?;
    assert_eq!(response.status(), StatusCode::OK);
    let body: Value = serde_json::from_slice(&to_bytes(response.into_body(), usize::MAX).await?)?;
    assert_eq!(body["companyId"], Value::Null);
    Ok(())
}
