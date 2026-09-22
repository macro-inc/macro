use std::collections::HashMap;
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
        AssignTaskStatus, AssignTasksResponse, AssignTasksResult, CreateInitiativeRequest,
        DescriptionDocumentId, InitiativeBasic, InitiativeDetail, InitiativeError, InitiativeId,
        InitiativeList, InitiativeSummary, MAX_INITIATIVE_NAME_GRAPHEMES, TaskAssignment,
        UpdateInitiativeRequest,
    },
    ports::InitiativeService,
};

const USER_ID: &str = "macro|initiative-router@macro.com";
const VALID_JWT: &str = "valid";
const TASK_OK: &str = "task-ok";
const TASK_DENIED: &str = "task-denied";
const TASK_MISSING: &str = "task-missing";

fn existing_id() -> InitiativeId {
    InitiativeId::from_uuid(Uuid::from_u128(1))
}

fn unknown_id() -> InitiativeId {
    InitiativeId::from_uuid(Uuid::from_u128(99))
}

fn description_document_id() -> DescriptionDocumentId {
    DescriptionDocumentId::from_uuid(Uuid::from_u128(2))
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
        id: existing_id(),
        name: "Launch".to_string(),
        owner_id: user(),
    }
}

fn sample_detail() -> InitiativeDetail {
    InitiativeDetail {
        id: existing_id(),
        name: "Launch".to_string(),
        description_document_id: description_document_id(),
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
            id: existing_id(),
            name: "Launch".to_string(),
            description_document_id: description_document_id(),
            updated_at: now(),
        }],
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
    document_denials: HashMap<String, fn() -> AccessError>,
}

impl FakeEntityAccessService {
    fn without_initiative_access() -> Self {
        Self {
            initiative_access: None,
            document_denials: HashMap::new(),
        }
    }

    fn denying_document(task_id: &str, denial: fn() -> AccessError) -> Self {
        let mut document_denials = HashMap::new();
        document_denials.insert(task_id.to_string(), denial);
        Self {
            initiative_access: Some(AccessLevel::Owner),
            document_denials,
        }
    }
}

impl Default for FakeEntityAccessService {
    fn default() -> Self {
        Self {
            initiative_access: Some(AccessLevel::Owner),
            document_denials: HashMap::new(),
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
        if let Some(denial) = self.document_denials.get(entity_id) {
            return Err(denial());
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
    Create { name: String },
    Get,
    Update,
    Assign(Vec<TaskAssignment>),
    Unassign { task_id: String },
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

    async fn assign_tasks(
        &self,
        _receipt: EntityAccessReceipt<EditAccessLevel>,
        assignments: Vec<TaskAssignment>,
    ) -> Result<AssignTasksResponse, InitiativeError> {
        self.record(ServiceCall::Assign(assignments.clone()));
        Ok(AssignTasksResponse {
            results: assignments
                .into_iter()
                .map(|assignment| AssignTasksResult {
                    status: match &assignment {
                        TaskAssignment::Candidate { .. } => AssignTaskStatus::Assigned,
                        TaskAssignment::NotFound { .. } => AssignTaskStatus::NotFound,
                        TaskAssignment::SkippedNoPermission { .. } => {
                            AssignTaskStatus::SkippedNoPermission
                        }
                    },
                    task_id: assignment.task_id().to_string(),
                })
                .collect(),
        })
    }

    async fn unassign_task(
        &self,
        _receipt: EntityAccessReceipt<EditAccessLevel>,
        task_id: &str,
    ) -> Result<(), InitiativeError> {
        self.record(ServiceCall::Unassign {
            task_id: task_id.to_string(),
        });
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
async fn create_response_points_at_the_description_document_instead_of_inlining_text() {
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
    assert_eq!(
        body["descriptionDocumentId"],
        serde_json::json!(description_document_id().to_string())
    );
    assert!(body.get("description").is_none());
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

#[tokio::test]
async fn assign_tasks_returns_200() {
    let service = FakeInitiativeService::default();
    let response = send(
        build_router(service.clone(), FakeEntityAccessService::default()),
        authed(axum::http::Request::put(format!(
            "/{}/tasks",
            existing_id()
        )))
        .header(header::CONTENT_TYPE, "application/json")
        .body(json_body(serde_json::json!({ "taskIds": [TASK_OK] })))
        .expect("request should build"),
    )
    .await;

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        read_json(response).await,
        serde_json::json!({
            "results": [{ "taskId": TASK_OK, "status": "assigned" }]
        })
    );
    assert_eq!(
        service.calls(),
        vec![ServiceCall::Assign(vec![TaskAssignment::Candidate {
            task_id: TASK_OK.to_string()
        }])]
    );
}

#[tokio::test]
async fn unassign_task_returns_200() {
    let service = FakeInitiativeService::default();
    let response = send(
        build_router(service.clone(), FakeEntityAccessService::default()),
        authed(axum::http::Request::delete(format!(
            "/{}/tasks/{TASK_OK}",
            existing_id()
        )))
        .body(axum::body::Body::empty())
        .expect("request should build"),
    )
    .await;

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        read_json(response).await,
        serde_json::json!({ "success": true })
    );
    assert_eq!(
        service.calls(),
        vec![ServiceCall::Unassign {
            task_id: TASK_OK.to_string()
        }]
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
async fn assign_unauthorized_is_skipped_no_permission() {
    let service = FakeInitiativeService::default();
    let response = send(
        build_router(
            service.clone(),
            FakeEntityAccessService::denying_document(TASK_DENIED, || AccessError::Unauthorized),
        ),
        authed(axum::http::Request::put(format!(
            "/{}/tasks",
            existing_id()
        )))
        .header(header::CONTENT_TYPE, "application/json")
        .body(json_body(serde_json::json!({
            "taskIds": [TASK_DENIED, TASK_OK]
        })))
        .expect("request should build"),
    )
    .await;

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        read_json(response).await,
        serde_json::json!({
            "results": [
                { "taskId": TASK_DENIED, "status": "skippedNoPermission" },
                { "taskId": TASK_OK, "status": "assigned" }
            ]
        })
    );
}

#[tokio::test]
async fn assign_unauthorized_with_message_is_skipped_no_permission() {
    let response = send(
        build_router(
            FakeInitiativeService::default(),
            FakeEntityAccessService::denying_document(TASK_DENIED, || {
                AccessError::UnauthorizedWithMessage("nope")
            }),
        ),
        authed(axum::http::Request::put(format!(
            "/{}/tasks",
            existing_id()
        )))
        .header(header::CONTENT_TYPE, "application/json")
        .body(json_body(serde_json::json!({ "taskIds": [TASK_DENIED] })))
        .expect("request should build"),
    )
    .await;

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        read_json(response).await,
        serde_json::json!({
            "results": [{ "taskId": TASK_DENIED, "status": "skippedNoPermission" }]
        })
    );
}

#[tokio::test]
async fn assign_not_found_is_not_found() {
    let response = send(
        build_router(
            FakeInitiativeService::default(),
            FakeEntityAccessService::denying_document(TASK_MISSING, || {
                AccessError::NotFound("task")
            }),
        ),
        authed(axum::http::Request::put(format!(
            "/{}/tasks",
            existing_id()
        )))
        .header(header::CONTENT_TYPE, "application/json")
        .body(json_body(serde_json::json!({ "taskIds": [TASK_MISSING] })))
        .expect("request should build"),
    )
    .await;

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        read_json(response).await,
        serde_json::json!({
            "results": [{ "taskId": TASK_MISSING, "status": "notFound" }]
        })
    );
}

#[tokio::test]
async fn assign_bad_request_is_not_found() {
    let response = send(
        build_router(
            FakeInitiativeService::default(),
            FakeEntityAccessService::denying_document(TASK_MISSING, || {
                AccessError::BadRequest("bad")
            }),
        ),
        authed(axum::http::Request::put(format!(
            "/{}/tasks",
            existing_id()
        )))
        .header(header::CONTENT_TYPE, "application/json")
        .body(json_body(serde_json::json!({ "taskIds": [TASK_MISSING] })))
        .expect("request should build"),
    )
    .await;

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        read_json(response).await,
        serde_json::json!({
            "results": [{ "taskId": TASK_MISSING, "status": "notFound" }]
        })
    );
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
