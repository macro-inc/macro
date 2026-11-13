use std::sync::{Arc, Mutex};

use axum::http::{StatusCode, header};
use chrono::{DateTime, TimeZone, Utc};
use entity_access::domain::models::{
    AccessError, AccessLevel, BotAccessScope, BotId, CallChannelInfo, EditAccessLevel, Entity,
    EntityAccessReceipt, EntityPermission, EntityType, OwnerAccessLevel, RequiredPermission,
    TeamRole, UserTeamInfo, ViewAccessLevel,
};
use entity_access::domain::ports::EntityAccessService;
use http_body_util::BodyExt;
use macro_authorization::{
    InternalIdentityClaims, MacroAuthorizationError, MacroAuthorizationService,
    MacroAuthorizationState,
};
use macro_user_id::cowlike::CowLike;
use macro_user_id::{
    lowercased::Lowercase,
    user_id::{MacroUserId, MacroUserIdStr},
};
use model_user::UserContext;
use models_permissions::share_permission::SharePermissionV2;
use rootcause::Report;
use tower::ServiceExt;
use uuid::Uuid;

use super::*;
use crate::domain::{
    models::{
        CreateInitiativeRequest, InitiativeBasic, InitiativeDetail, InitiativeError, InitiativeId,
        InitiativeList, InitiativeSummary, MAX_INITIATIVE_NAME_GRAPHEMES, UpdateInitiativeRequest,
    },
    ports::InitiativeService,
};

const USER_ID: &str = "macro|initiative-router@macro.com";
const VALID_JWT: &str = "valid";

fn existing_id() -> InitiativeId {
    InitiativeId::from_uuid(Uuid::from_u128(1))
}

fn unknown_id() -> InitiativeId {
    InitiativeId::from_uuid(Uuid::from_u128(99))
}

fn now() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 9, 15, 12, 0, 0)
        .single()
        .expect("unambiguous instant")
}

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(USER_ID)
        .expect("valid user id")
        .into_owned()
}

fn user_context() -> UserContext {
    UserContext {
        user_id: USER_ID.to_string(),
        fusion_user_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb".to_string(),
        permissions: None,
        organization_id: Some(42),
    }
}

fn share_permission() -> SharePermissionV2 {
    SharePermissionV2::new_initiative_share_permission(None)
}

fn sample_basic() -> InitiativeBasic {
    InitiativeBasic {
        appearance: None,
        id: existing_id(),
        name: "Launch".to_string(),
        owner_id: user(),
    }
}

fn sample_detail() -> InitiativeDetail {
    InitiativeDetail {
        appearance: None,
        id: existing_id(),
        name: "Launch".to_string(),
        owner_id: user(),
        member_ids: Vec::new(),
        task_ids: Vec::new(),
        share_permission: share_permission(),
        user_access_level: AccessLevel::Edit,
        created_at: now(),
        updated_at: now(),
    }
}

fn sample_list() -> InitiativeList {
    InitiativeList {
        initiatives: vec![InitiativeSummary {
            appearance: None,
            id: existing_id(),
            name: "Launch".to_string(),
            updated_at: now(),
        }],
    }
}

fn sample_page() -> crate::domain::reads::InitiativePage {
    crate::domain::reads::InitiativePage {
        initiatives: vec![crate::domain::reads::InitiativePageRow {
            initiative: sample_list().initiatives.remove(0),
            user_access_level: AccessLevel::Edit,
            properties: crate::domain::reads::InitiativePropertySnapshot {
                status: Some(Uuid::from_u128(7)),
                priority: None,
                assignees: vec![USER_ID.to_string()],
                due_date: Some(now()),
                completed: false,
            },
            task_count: 3,
            completed_task_count: 1,
        }],
        next_cursor: Some("next".to_string()),
    }
}

#[derive(Clone)]
struct FakeAuthorizationService;

impl MacroAuthorizationService for FakeAuthorizationService {
    async fn authorize(&self, jwt: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        if jwt != VALID_JWT {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }
        Ok(user_context())
    }

    async fn authorize_identity(
        &self,
        jwt: &str,
    ) -> Result<macro_authorization::ValidatedCredential, Report<MacroAuthorizationError>> {
        self.authorize(jwt)
            .await
            .map(macro_authorization::ValidatedCredential::session)
    }

    async fn authorize_internal(
        &self,
        _provided_key: &str,
        _claims: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        Err(Report::new(MacroAuthorizationError::InvalidCredentials))
    }
}

#[derive(Clone)]
struct FakeEntityAccessService {
    initiative_access: Option<AccessLevel>,
}

impl FakeEntityAccessService {
    fn without_initiative_access() -> Self {
        Self {
            initiative_access: None,
        }
    }
}

impl Default for FakeEntityAccessService {
    fn default() -> Self {
        Self {
            initiative_access: Some(AccessLevel::Owner),
        }
    }
}

impl EntityAccessService for FakeEntityAccessService {
    async fn generate_entity_access_receipt<T: RequiredPermission>(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
        _user_org_id: Option<i64>,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        if entity_type != EntityType::Document {
            return Err(AccessError::internal("test access failure"));
        }
        EntityAccessReceipt::try_new_authenticated_user(
            MacroUserIdStr::parse_from_str(USER_ID)
                .expect("valid user id")
                .clone(),
            Entity {
                entity_id: entity_id.to_string(),
                entity_type,
            },
            EntityPermission::AccessLevel {
                access_level: AccessLevel::Edit,
            },
        )
        .inspect(|_| debug_assert_eq!(user_id.as_ref(), USER_ID))
    }

    async fn generate_bot_entity_access_receipt<T: RequiredPermission>(
        &self,
        _bot_id: BotId,
        _scope: BotAccessScope,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        Err(AccessError::internal("test access failure"))
    }

    async fn get_access_level(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        entity_type: EntityType,
    ) -> Result<Option<AccessLevel>, AccessError> {
        if entity_type != EntityType::Initiative {
            return Err(AccessError::internal("test access failure"));
        }
        Ok(self.initiative_access)
    }

    async fn check_access(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        Err(AccessError::internal("test access failure"))
    }

    async fn check_public_access(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        Err(AccessError::internal("test access failure"))
    }

    async fn get_entity_permission(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _user_org_id: Option<i64>,
    ) -> Result<EntityPermission, AccessError> {
        Err(AccessError::internal("test access failure"))
    }

    async fn get_crm_entity_permission_with_team(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<(EntityPermission, Uuid, TeamRole), AccessError> {
        Err(AccessError::internal("test access failure"))
    }

    async fn get_users_by_entity(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        Err(AccessError::internal("test access failure"))
    }

    async fn get_call_channel(
        &self,
        _call_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        Err(AccessError::internal("test access failure"))
    }

    async fn get_call_channel_by_channel_id(
        &self,
        _channel_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        Err(AccessError::internal("test access failure"))
    }

    async fn get_user_team(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Option<UserTeamInfo>, AccessError> {
        Err(AccessError::internal("test access failure"))
    }
}

#[derive(Debug, Clone, PartialEq)]
enum ServiceCall {
    List,
    Page(crate::domain::reads::InitiativePageRequest),
    Description,
    Create { name: String },
    Get,
    Update,
    Delete,
}

#[derive(Clone, Default)]
struct FakeInitiativeService {
    calls: Arc<Mutex<Vec<ServiceCall>>>,
}

impl FakeInitiativeService {
    fn calls(&self) -> Vec<ServiceCall> {
        self.calls.lock().expect("call log poisoned").clone()
    }

    fn record(&self, call: ServiceCall) {
        self.calls.lock().expect("call log poisoned").push(call);
    }
}

fn reject_name(name: &str) -> Result<(), InitiativeError> {
    if name.chars().count() > MAX_INITIATIVE_NAME_GRAPHEMES {
        return Err(InitiativeError::NameTooLong {
            max: MAX_INITIATIVE_NAME_GRAPHEMES,
        });
    }
    Ok(())
}

impl InitiativeService for FakeInitiativeService {
    async fn set_appearance(
        &self,
        _receipt: EntityAccessReceipt<EditAccessLevel>,
        appearance: model_entity::EntityAppearance,
    ) -> Result<model_entity::EntityAppearance, InitiativeError> {
        appearance.validate().map_err(InitiativeError::BadRequest)?;
        Ok(appearance)
    }
    async fn summary(
        &self,
        _receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<crate::domain::reads::InitiativePageRow, InitiativeError> {
        Err(InitiativeError::NotFound)
    }

    async fn read(
        &self,
        _receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<crate::domain::reads::InitiativeRead, InitiativeError> {
        Err(InitiativeError::NotFound)
    }

    async fn summarize(
        &self,
        _read: &crate::domain::reads::InitiativeRead,
    ) -> Result<crate::domain::reads::InitiativePageRow, InitiativeError> {
        Err(InitiativeError::NotFound)
    }

    async fn create_attributed(
        &self,
        user_id: &MacroUserIdStr<'_>,
        request: CreateInitiativeRequest,
        _attribution: ::activity::Attribution,
    ) -> Result<InitiativeDetail, InitiativeError> {
        self.create(user_id, request).await
    }
    async fn page(
        &self,
        _user_id: &MacroUserIdStr<'_>,
        request: crate::domain::reads::InitiativePageRequest,
    ) -> Result<crate::domain::reads::InitiativePage, InitiativeError> {
        self.record(ServiceCall::Page(request));
        Ok(sample_page())
    }

    async fn tasks_page(
        &self,
        _receipt: EntityAccessReceipt<ViewAccessLevel>,
        _request: crate::domain::reads::InitiativeTasksRequest,
    ) -> Result<crate::domain::reads::InitiativeTasksPage, InitiativeError> {
        Ok(crate::domain::reads::InitiativeTasksPage {
            task_ids: Vec::new(),
            next_cursor: None,
            total: 0,
        })
    }

    async fn create(
        &self,
        _user_id: &MacroUserIdStr<'_>,
        request: CreateInitiativeRequest,
    ) -> Result<InitiativeDetail, InitiativeError> {
        reject_name(&request.name)?;
        self.record(ServiceCall::Create {
            name: request.name.clone(),
        });
        Ok(sample_detail())
    }

    async fn internal_get_basic(
        &self,
        id: InitiativeId,
    ) -> Result<InitiativeBasic, InitiativeError> {
        if id != existing_id() {
            return Err(InitiativeError::NotFound);
        }
        Ok(sample_basic())
    }

    async fn get(
        &self,
        _receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<InitiativeDetail, InitiativeError> {
        self.record(ServiceCall::Get);
        Ok(sample_detail())
    }

    async fn list(&self, _user_id: &MacroUserIdStr<'_>) -> Result<InitiativeList, InitiativeError> {
        self.record(ServiceCall::List);
        Ok(sample_list())
    }

    async fn ensure_description_surface(
        &self,
        _receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<(), InitiativeError> {
        Ok(())
    }

    async fn read_description(
        &self,
        _receipt: EntityAccessReceipt<ViewAccessLevel>,
    ) -> Result<String, InitiativeError> {
        self.record(ServiceCall::Description);
        Ok("## Goals\n\nShip it.".to_string())
    }

    async fn update(
        &self,
        _receipt: EntityAccessReceipt<EditAccessLevel>,
        request: UpdateInitiativeRequest,
    ) -> Result<InitiativeDetail, InitiativeError> {
        if let Some(name) = &request.name {
            reject_name(name)?;
        }
        self.record(ServiceCall::Update);
        Ok(sample_detail())
    }

    async fn grant_assignees(
        &self,
        _receipt: EntityAccessReceipt<EditAccessLevel>,
        _user_ids: Vec<MacroUserIdStr<'static>>,
    ) -> Result<(), InitiativeError> {
        Ok(())
    }

    async fn delete(
        &self,
        _receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<(), InitiativeError> {
        self.record(ServiceCall::Delete);
        Ok(())
    }
}

fn build_router(service: FakeInitiativeService, access: FakeEntityAccessService) -> axum::Router {
    initiative_router(InitiativeRouterState::new(
        Arc::new(service),
        Arc::new(access),
        MacroAuthorizationState::new(Arc::new(FakeAuthorizationService)),
    ))
}

fn authed(builder: axum::http::request::Builder) -> axum::http::request::Builder {
    builder.header(header::AUTHORIZATION, format!("Bearer {VALID_JWT}"))
}

fn json_body(value: serde_json::Value) -> axum::body::Body {
    axum::body::Body::from(value.to_string())
}

async fn read_json(response: axum::response::Response) -> serde_json::Value {
    let bytes = response
        .into_body()
        .collect()
        .await
        .expect("body should collect")
        .to_bytes();
    serde_json::from_slice(&bytes).expect("body should be json")
}

async fn send(
    router: axum::Router,
    request: axum::http::Request<axum::body::Body>,
) -> axum::response::Response {
    router
        .oneshot(request)
        .await
        .expect("router should respond")
}

#[tokio::test]
async fn unknown_initiative_id_is_404() {
    let service = FakeInitiativeService::default();
    let response = send(
        build_router(service.clone(), FakeEntityAccessService::default()),
        authed(axum::http::Request::get(format!("/{}", unknown_id())))
            .body(axum::body::Body::empty())
            .expect("request should build"),
    )
    .await;

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        read_json(response).await,
        serde_json::json!({
            "message": format!("initiative with id \"{}\" was not found", unknown_id())
        })
    );
    assert!(service.calls().is_empty());
}

#[tokio::test]
async fn invalid_initiative_id_is_400() {
    let response = send(
        build_router(
            FakeInitiativeService::default(),
            FakeEntityAccessService::default(),
        ),
        authed(axum::http::Request::get("/not-a-uuid"))
            .body(axum::body::Body::empty())
            .expect("request should build"),
    )
    .await;

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        read_json(response).await,
        serde_json::json!({ "message": "invalid initiative id" })
    );
}

#[tokio::test]
async fn no_access_on_an_existing_id_is_401() {
    let service = FakeInitiativeService::default();
    let response = send(
        build_router(
            service.clone(),
            FakeEntityAccessService::without_initiative_access(),
        ),
        authed(axum::http::Request::get(format!("/{}", existing_id())))
            .body(axum::body::Body::empty())
            .expect("request should build"),
    )
    .await;

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        read_json(response).await,
        serde_json::json!({
            "message": "User does not have access to the requested resource"
        })
    );
    assert!(service.calls().is_empty());
}

#[tokio::test]
async fn list_returns_200() {
    let service = FakeInitiativeService::default();
    let response = send(
        build_router(service.clone(), FakeEntityAccessService::default()),
        authed(axum::http::Request::get("/"))
            .body(axum::body::Body::empty())
            .expect("request should build"),
    )
    .await;

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        read_json(response).await,
        serde_json::to_value(sample_list()).expect("list json")
    );
    assert_eq!(service.calls(), vec![ServiceCall::List]);
}

#[tokio::test]
async fn create_returns_200() {
    let service = FakeInitiativeService::default();
    let response = send(
        build_router(service.clone(), FakeEntityAccessService::default()),
        authed(axum::http::Request::post("/"))
            .header(header::CONTENT_TYPE, "application/json")
            .body(json_body(serde_json::json!({ "name": "Launch" })))
            .expect("request should build"),
    )
    .await;

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        read_json(response).await,
        serde_json::to_value(sample_detail()).expect("detail json")
    );
    assert_eq!(
        service.calls(),
        vec![ServiceCall::Create {
            name: "Launch".to_string()
        }]
    );
}

#[tokio::test]
async fn create_response_never_inlines_the_description() {
    let response = send(
        build_router(
            FakeInitiativeService::default(),
            FakeEntityAccessService::default(),
        ),
        authed(axum::http::Request::post("/"))
            .header(header::CONTENT_TYPE, "application/json")
            .body(json_body(serde_json::json!({
                "name": "Launch",
                "description": "## Goals"
            })))
            .expect("request should build"),
    )
    .await;

    assert_eq!(response.status(), StatusCode::OK);
    let body = read_json(response).await;
    // The description lives on the project's collab surface, which has the project's id.
    assert!(body.get("description").is_none());
    assert!(body.get("descriptionDocumentId").is_none());
    assert!(body.get("descriptionSurfaceId").is_none());
}

#[tokio::test]
async fn get_returns_200() {
    let service = FakeInitiativeService::default();
    let response = send(
        build_router(service.clone(), FakeEntityAccessService::default()),
        authed(axum::http::Request::get(format!("/{}", existing_id())))
            .body(axum::body::Body::empty())
            .expect("request should build"),
    )
    .await;

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        read_json(response).await,
        serde_json::to_value(sample_detail()).expect("detail json")
    );
    assert_eq!(service.calls(), vec![ServiceCall::Get]);
}

#[tokio::test]
async fn update_returns_200() {
    let service = FakeInitiativeService::default();
    let response = send(
        build_router(service.clone(), FakeEntityAccessService::default()),
        authed(axum::http::Request::patch(format!("/{}", existing_id())))
            .header(header::CONTENT_TYPE, "application/json")
            .body(json_body(serde_json::json!({ "name": "Renamed" })))
            .expect("request should build"),
    )
    .await;

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        read_json(response).await,
        serde_json::to_value(sample_detail()).expect("detail json")
    );
    assert_eq!(service.calls(), vec![ServiceCall::Update]);
}

/// A scoped session renames an initiative but never changes who it's shared
/// with: its sharing or its members, who are granted access.
#[tokio::test]
async fn a_scoped_session_edits_an_initiative_but_not_its_sharing() {
    use agent_correlation::context::{Attribution, scope_attribution};
    use agent_correlation::scope::SessionScope;

    let service = FakeInitiativeService::default();
    let router = build_router(service.clone(), FakeEntityAccessService::default());
    let edit = |body: serde_json::Value| {
        authed(axum::http::Request::patch(format!("/{}", existing_id())))
            .header(header::CONTENT_TYPE, "application/json")
            .body(json_body(body))
            .expect("request should build")
    };
    let no_send = Attribution {
        scope: Some(SessionScope::NoSend),
        ..Attribution::default()
    };
    let share = serde_json::json!({ "sharePermission": { "teamShareAccessLevel": "view" } });
    for (body, status) in [
        (share.clone(), StatusCode::FORBIDDEN),
        (
            serde_json::json!({ "memberIds": ["macro|member@macro.com"] }),
            StatusCode::FORBIDDEN,
        ),
        (serde_json::json!({ "name": "Renamed" }), StatusCode::OK),
    ] {
        let response = scope_attribution(no_send, send(router.clone(), edit(body.clone()))).await;
        assert_eq!(response.status(), status, "{body}");
    }
    let response = send(router, edit(share)).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        service.calls(),
        vec![ServiceCall::Update, ServiceCall::Update]
    );
}

#[tokio::test]
async fn delete_returns_200() {
    let service = FakeInitiativeService::default();
    let response = send(
        build_router(service.clone(), FakeEntityAccessService::default()),
        authed(axum::http::Request::delete(format!("/{}", existing_id())))
            .body(axum::body::Body::empty())
            .expect("request should build"),
    )
    .await;

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        read_json(response).await,
        serde_json::json!({ "success": true })
    );
    assert_eq!(service.calls(), vec![ServiceCall::Delete]);
}

#[tokio::test]
async fn a_name_that_is_too_long_is_422() {
    let name = "x".repeat(MAX_INITIATIVE_NAME_GRAPHEMES + 1);
    let service = FakeInitiativeService::default();
    let response = send(
        build_router(service.clone(), FakeEntityAccessService::default()),
        authed(axum::http::Request::post("/"))
            .header(header::CONTENT_TYPE, "application/json")
            .body(json_body(serde_json::json!({ "name": name })))
            .expect("request should build"),
    )
    .await;

    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        read_json(response).await,
        serde_json::json!({ "message": "name too long" })
    );
    assert!(service.calls().is_empty());
}

#[tokio::test]
async fn list_without_credentials_is_401() {
    let response = send(
        build_router(
            FakeInitiativeService::default(),
            FakeEntityAccessService::default(),
        ),
        axum::http::Request::get("/")
            .body(axum::body::Body::empty())
            .expect("request should build"),
    )
    .await;

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn task_membership_routes_are_gone() {
    // Tasks join a project through their Project property instead.
    let service = FakeInitiativeService::default();
    for request in [
        authed(axum::http::Request::put(format!(
            "/{}/tasks",
            existing_id()
        )))
        .header(header::CONTENT_TYPE, "application/json")
        .body(json_body(serde_json::json!({ "taskIds": ["task-1"] }))),
        authed(axum::http::Request::delete(format!(
            "/{}/tasks/task-1",
            existing_id()
        )))
        .body(axum::body::Body::empty()),
    ] {
        let response = send(
            build_router(service.clone(), FakeEntityAccessService::default()),
            request.expect("request should build"),
        )
        .await;
        assert!(response.status().is_client_error(), "{}", response.status());
    }
    assert!(service.calls().is_empty());
}

#[tokio::test]
async fn appearance_requires_edit_access() {
    for (level, expected) in [
        (AccessLevel::View, StatusCode::UNAUTHORIZED),
        (AccessLevel::Edit, StatusCode::OK),
        (AccessLevel::Owner, StatusCode::OK),
    ] {
        let response = send(
            build_router(
                FakeInitiativeService::default(),
                FakeEntityAccessService {
                    initiative_access: Some(level),
                },
            ),
            authed(axum::http::Request::put(format!(
                "/{}/appearance",
                existing_id()
            )))
            .header(header::CONTENT_TYPE, "application/json")
            .body(json_body(serde_json::json!({"color":"blue"})))
            .unwrap(),
        )
        .await;
        assert_eq!(response.status(), expected);
    }
}

#[tokio::test]
async fn page_passes_filters_and_returns_rows_with_progress() {
    let service = FakeInitiativeService::default();
    let status = Uuid::from_u128(7);
    let response = send(
        build_router(service.clone(), FakeEntityAccessService::default()),
        authed(axum::http::Request::get(format!(
            "/page?query=launch&status={status}&assignee=macro%7Cother%40macro.com\
             &dueBefore=2026-09-15T12%3A00%3A00Z&sort=due&descending=false&limit=10&cursor=abc"
        )))
        .body(axum::body::Body::empty())
        .expect("request should build"),
    )
    .await;

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        read_json(response).await,
        serde_json::json!({
            "initiatives": [{
                "id": existing_id().to_string(),
                "name": "Launch",
                "updatedAt": "2026-09-15T12:00:00Z",
                "userAccessLevel": "edit",
                "properties": {
                    "status": status.to_string(),
                    "priority": null,
                    "assignees": [USER_ID],
                    "dueDate": "2026-09-15T12:00:00Z",
                    "completed": false,
                },
                "taskCount": 3,
                "completedTaskCount": 1,
            }],
            "nextCursor": "next",
        })
    );
    assert_eq!(
        service.calls(),
        vec![ServiceCall::Page(
            crate::domain::reads::InitiativePageRequest {
                limit: Some(10),
                cursor: Some("abc".to_string()),
                query: Some("launch".to_string()),
                status: Some(status),
                priority: None,
                assignee: Some("macro|other@macro.com".to_string()),
                due_after: None,
                due_before: Some(now()),
                sort: crate::domain::reads::InitiativeSort::Due,
                descending: Some(false),
            }
        )]
    );
}

#[tokio::test]
async fn page_without_credentials_is_401() {
    let response = send(
        build_router(
            FakeInitiativeService::default(),
            FakeEntityAccessService::default(),
        ),
        axum::http::Request::get("/page")
            .body(axum::body::Body::empty())
            .expect("request should build"),
    )
    .await;

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn description_returns_markdown() {
    let service = FakeInitiativeService::default();
    let response = send(
        build_router(service.clone(), FakeEntityAccessService::default()),
        authed(axum::http::Request::get(format!(
            "/{}/description",
            existing_id()
        )))
        .body(axum::body::Body::empty())
        .expect("request should build"),
    )
    .await;

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        read_json(response).await,
        serde_json::json!({ "markdown": "## Goals\n\nShip it." })
    );
    assert_eq!(service.calls(), vec![ServiceCall::Description]);
}

#[tokio::test]
async fn description_without_access_is_401() {
    let service = FakeInitiativeService::default();
    let response = send(
        build_router(
            service.clone(),
            FakeEntityAccessService::without_initiative_access(),
        ),
        authed(axum::http::Request::get(format!(
            "/{}/description",
            existing_id()
        )))
        .body(axum::body::Body::empty())
        .expect("request should build"),
    )
    .await;

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert!(service.calls().is_empty());
}

#[derive(Clone)]
struct FakeActivityReads;

impl ::activity::domain::ports::EntityActivityReads for FakeActivityReads {
    type Err = std::io::Error;

    async fn entity_feed(
        &self,
        entity_type: EntityType,
        _entity_id: &str,
        cursor: Option<(DateTime<Utc>, Uuid)>,
        _limit: std::num::NonZeroU32,
    ) -> Result<::activity::ActivityFeedPage, Self::Err> {
        assert_eq!(entity_type, EntityType::Initiative);
        assert_eq!(cursor, None);
        let record = |id: u128, occurred_at: &str| ::activity::domain::models::ActivityRecord {
            agent_correlation_id: None,
            agent_verb: None,
            id: Uuid::from_u128(id),
            actor: ::activity::domain::models::Actor::new_from_user(user()),
            subject_id: USER_ID.to_string(),
            entity_type: EntityType::Initiative,
            entity_id: existing_id().to_string(),
            action: ::activity::domain::models::RecordedAction::Known(
                ::activity::domain::models::Action::Edited,
            ),
            occurred_at: DateTime::parse_from_rfc3339(occurred_at)
                .expect("valid timestamp")
                .with_timezone(&Utc),
        };
        Ok(::activity::ActivityFeedPage {
            records: vec![
                record(3, "2026-09-15T11:00:00Z"),
                record(2, "2026-09-14T11:00:00Z"),
            ],
            next: Some((
                DateTime::parse_from_rfc3339("2026-09-14T11:00:00Z")
                    .expect("valid timestamp")
                    .with_timezone(&Utc),
                Uuid::from_u128(2),
            )),
        })
    }
}

fn build_activity_router() -> axum::Router {
    let access = Arc::new(FakeEntityAccessService::default());
    initiative_activity_router(InitiativeActivityRouterState::new(
        Arc::new(crate::domain::history::InitiativeHistory::new(
            FakeActivityReads,
            access.clone(),
        )),
        access,
        MacroAuthorizationState::new(Arc::new(FakeAuthorizationService)),
    ))
}

#[tokio::test]
async fn activity_keeps_records_and_cursor_inside_the_window() {
    let response = send(
        build_activity_router(),
        authed(axum::http::Request::get(format!(
            "/{}/activity?after=2026-09-15T00:00:00Z",
            existing_id()
        )))
        .body(axum::body::Body::empty())
        .expect("request should build"),
    )
    .await;

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        read_json(response).await,
        serde_json::json!({
            "records": [{
                "id": Uuid::from_u128(3).to_string(),
                "actorId": USER_ID,
                "subjectId": USER_ID,
                "action": "edited",
                "actionPayload": null,
                "occurredAt": "2026-09-15T11:00:00Z",
            }],
            "nextCursor": null,
        })
    );
}

#[tokio::test]
async fn activity_rejects_half_a_cursor() {
    let response = send(
        build_activity_router(),
        authed(axum::http::Request::get(format!(
            "/{}/activity?cursorId={}",
            existing_id(),
            Uuid::from_u128(2)
        )))
        .body(axum::body::Body::empty())
        .expect("request should build"),
    )
    .await;

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}
