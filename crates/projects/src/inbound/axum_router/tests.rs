use entity_access::domain::models::TeamRole;
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
};
use entity_access::domain::{
    models::{
        AccessError, AccessLevel, BotAccessScope, BotId, CallChannelInfo, EntityAccessReceipt,
        EntityPermission, EntityType, RequiredPermission, UserTeamInfo,
    },
    ports::EntityAccessService,
};
use http_body_util::BodyExt;
use macro_authorization::{
    InternalIdentityClaims, MacroAuthorizationError, MacroAuthorizationService,
    MacroAuthorizationState,
};
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId, user_id::MacroUserIdStr};
use model::{
    folder::{FileSystemNodeWithIds, UploadFolderRequest, UploadFolderResponseData},
    item::ItemWithUserAccessLevel,
    project::{
        BasicProject, PendingProject, Project, ProjectPreview,
        request::{CreateProjectRequest, PatchProjectRequestV2},
        response::GetProjectResponseData,
    },
};
use model_user::UserContext;
use models_bulk_upload::{UploadExtractFolderRequest, UploadExtractFolderResponseData};
use models_permissions::share_permission::{
    SharePermissionV2, access_level::AccessLevel as ShareAccessLevel,
};
use rootcause::Report;
use serde_json::{Value, json};
use tower::ServiceExt;
use uuid::Uuid;

use super::{ProjectRouterState, projects_router};
use crate::domain::{
    models::{ProjectError, SoftDeleteResult},
    ports::ProjectService,
};

const TOKEN: &str = "valid-token";
const INTERNAL_KEY: &str = "internal-key";
const USER_ID: &str = "macro|router@example.com";
const PROJECT_ID: &str = "project-1";

#[derive(Clone)]
struct FakeProjectService {
    basic_project: Arc<Mutex<Result<BasicProject, String>>>,
    mutations: Arc<Mutex<Vec<&'static str>>>,
    permanently_deleted_projects: Arc<Mutex<Vec<BasicProject>>>,
    upload_internal_flags: Arc<Mutex<Vec<bool>>>,
}

impl FakeProjectService {
    fn with_project(owner: &str, deleted: bool) -> Self {
        Self {
            basic_project: Arc::new(Mutex::new(Ok(BasicProject {
                id: PROJECT_ID.to_string(),
                user_id: user_id(owner),
                parent_id: None,
                name: "Project".to_string(),
                deleted_at: deleted.then(chrono::Utc::now),
            }))),
            mutations: Arc::new(Mutex::new(Vec::new())),
            permanently_deleted_projects: Arc::new(Mutex::new(Vec::new())),
            upload_internal_flags: Arc::new(Mutex::new(Vec::new())),
        }
    }

    fn missing() -> Self {
        Self {
            basic_project: Arc::new(Mutex::new(Err("missing".to_string()))),
            mutations: Arc::new(Mutex::new(Vec::new())),
            permanently_deleted_projects: Arc::new(Mutex::new(Vec::new())),
            upload_internal_flags: Arc::new(Mutex::new(Vec::new())),
        }
    }
}

impl ProjectService for FakeProjectService {
    async fn list_projects(
        &self,
        _user_id: MacroUserIdStr<'static>,
    ) -> Result<Vec<Project>, ProjectError> {
        Ok(vec![project()])
    }

    async fn list_pending_projects(
        &self,
        _user_id: MacroUserIdStr<'static>,
    ) -> Result<Vec<PendingProject>, ProjectError> {
        Ok(Vec::new())
    }

    async fn get_project(
        &self,
        _receipt: EntityAccessReceipt<entity_access::domain::models::ViewAccessLevel>,
    ) -> Result<GetProjectResponseData, ProjectError> {
        Ok(GetProjectResponseData {
            project_metadata: project(),
            user_access_level: ShareAccessLevel::Owner,
        })
    }

    async fn get_project_content(
        &self,
        _receipt: EntityAccessReceipt<entity_access::domain::models::ViewAccessLevel>,
    ) -> Result<Vec<ItemWithUserAccessLevel>, ProjectError> {
        Ok(Vec::new())
    }

    async fn get_project_permissions(
        &self,
        _receipt: EntityAccessReceipt<entity_access::domain::models::OwnerAccessLevel>,
    ) -> Result<SharePermissionV2, ProjectError> {
        panic!("permissions are not used by these tests")
    }

    async fn get_project_access_level(
        &self,
        _receipt: EntityAccessReceipt<entity_access::domain::models::ViewAccessLevel>,
    ) -> Result<ShareAccessLevel, ProjectError> {
        Ok(ShareAccessLevel::Owner)
    }

    async fn create_project(
        &self,
        _actor: MacroUserIdStr<'static>,
        _args: CreateProjectRequest,
    ) -> Result<Project, ProjectError> {
        self.mutations
            .lock()
            .expect("mutation lock poisoned")
            .push("create");
        Ok(project())
    }

    async fn edit_project(
        &self,
        _receipt: EntityAccessReceipt<entity_access::domain::models::EditAccessLevel>,
        _project: BasicProject,
        _args: PatchProjectRequestV2,
    ) -> Result<(), ProjectError> {
        if _project.deleted_at.is_some() {
            return Err(ProjectError::CannotModifyDeleted);
        }
        self.mutations
            .lock()
            .expect("mutation lock poisoned")
            .push("edit");
        Ok(())
    }

    async fn soft_delete_project(
        &self,
        _receipt: EntityAccessReceipt<entity_access::domain::models::OwnerAccessLevel>,
        _project: BasicProject,
        _actor_user_id: String,
    ) -> Result<SoftDeleteResult, ProjectError> {
        self.mutations
            .lock()
            .expect("mutation lock poisoned")
            .push("delete");
        Ok(SoftDeleteResult {
            project_ids: vec![PROJECT_ID.to_string()],
            document_ids: vec!["document-1".to_string()],
            chat_ids: vec!["chat-1".to_string()],
        })
    }

    async fn permanently_delete_project(
        &self,
        _receipt: EntityAccessReceipt<entity_access::domain::models::OwnerAccessLevel>,
        project: BasicProject,
    ) -> Result<(), ProjectError> {
        self.mutations
            .lock()
            .expect("mutation lock poisoned")
            .push("permanent_delete");
        self.permanently_deleted_projects
            .lock()
            .expect("permanently deleted project lock poisoned")
            .push(project);
        Ok(())
    }

    async fn revert_delete_project(
        &self,
        _receipt: EntityAccessReceipt<entity_access::domain::models::OwnerAccessLevel>,
        _project: BasicProject,
    ) -> Result<(), ProjectError> {
        self.mutations
            .lock()
            .expect("mutation lock poisoned")
            .push("revert");
        Ok(())
    }

    async fn upload_folder(
        &self,
        _actor: MacroUserIdStr<'static>,
        internal: bool,
        _args: UploadFolderRequest,
    ) -> Result<UploadFolderResponseData, ProjectError> {
        self.upload_internal_flags
            .lock()
            .expect("upload flag lock poisoned")
            .push(internal);
        Ok(UploadFolderResponseData {
            file_system: FileSystemNodeWithIds::Folder {
                content: HashMap::new(),
                project_id: PROJECT_ID.to_string(),
            },
            destination_map: HashMap::new(),
        })
    }

    async fn create_upload_extract_request(
        &self,
        _actor: MacroUserIdStr<'static>,
        _args: UploadExtractFolderRequest,
    ) -> Result<UploadExtractFolderResponseData, ProjectError> {
        panic!("upload extraction is not used by these tests")
    }

    async fn mark_projects_uploaded(
        &self,
        _root_project_id: &str,
    ) -> Result<Vec<String>, ProjectError> {
        Ok(vec![PROJECT_ID.to_string(), "project-child".to_string()])
    }

    async fn get_batch_preview(
        &self,
        _actor: Option<MacroUserIdStr<'static>>,
        _project_ids: Vec<String>,
    ) -> Result<Vec<ProjectPreview>, ProjectError> {
        Ok(Vec::new())
    }

    async fn internal_get_basic_project(
        &self,
        _project_id: &str,
    ) -> Result<BasicProject, ProjectError> {
        self.basic_project
            .lock()
            .expect("basic project lock poisoned")
            .clone()
            .map_err(ProjectError::NotFound)
    }
}

#[derive(Clone)]
struct FakeEntityAccessService {
    access_level: Option<AccessLevel>,
}

impl EntityAccessService for FakeEntityAccessService {
    async fn generate_entity_access_receipt<T: RequiredPermission>(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
        _user_org_id: Option<i64>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        Err(AccessError::Unauthorized)
    }

    async fn generate_bot_entity_access_receipt<T: RequiredPermission>(
        &self,
        _bot_id: BotId,
        _scope: BotAccessScope,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        panic!("unexpected bot receipt generation")
    }

    async fn get_access_level(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Option<AccessLevel>, AccessError> {
        Ok(self.access_level)
    }

    async fn check_access(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        panic!("unexpected access check")
    }

    async fn check_public_access(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        panic!("unexpected public access check")
    }

    async fn get_entity_permission(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _user_org_id: Option<i64>,
    ) -> Result<EntityPermission, AccessError> {
        panic!("unexpected permission lookup")
    }

    async fn get_crm_entity_permission_with_team(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<(EntityPermission, Uuid, TeamRole), AccessError> {
        panic!("unexpected CRM permission lookup")
    }

    async fn get_users_by_entity(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        panic!("unexpected user lookup")
    }

    async fn get_call_channel(
        &self,
        _call_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        panic!("unexpected call lookup")
    }

    async fn get_call_channel_by_channel_id(
        &self,
        _channel_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        panic!("unexpected channel lookup")
    }

    async fn get_user_team(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Option<UserTeamInfo>, AccessError> {
        panic!("unexpected team lookup")
    }
}

#[derive(Clone, Default)]
struct FakeAuthorizationService;

impl MacroAuthorizationService for FakeAuthorizationService {
    async fn authorize(&self, token: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        if token != TOKEN {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }
        Ok(user_context(USER_ID))
    }

    async fn authorize_internal(
        &self,
        provided_key: &str,
        claims: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        if provided_key != INTERNAL_KEY {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }
        Ok(claims.user_id.map(|user_id| user_context(&user_id)))
    }
}

fn router(service: FakeProjectService, access_level: Option<AccessLevel>) -> Router {
    projects_router::<FakeProjectService, FakeEntityAccessService, FakeAuthorizationService, ()>(
        ProjectRouterState {
            service: Arc::new(service),
            access_service: Arc::new(FakeEntityAccessService { access_level }),
            authorization_state: MacroAuthorizationState::new(Arc::new(FakeAuthorizationService)),
        },
    )
}

fn user_id(value: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(value.to_string()).expect("test user id should be valid")
}

fn user_context(value: &str) -> UserContext {
    UserContext {
        user_id: value.to_string(),
        fusion_user_id: "fusion-user".to_string(),
        permissions: None,
        organization_id: None,
    }
}

fn project() -> Project {
    Project {
        id: PROJECT_ID.to_string(),
        name: "Project".to_string(),
        user_id: USER_ID.to_string(),
        parent_id: None,
        created_at: None,
        updated_at: None,
        deleted_at: None,
    }
}

fn authenticated_request(uri: &str) -> Request<Body> {
    Request::get(uri)
        .header("authorization", format!("Bearer {TOKEN}"))
        .body(Body::empty())
        .expect("request should be valid")
}

fn authenticated_json_request(method: &str, uri: &str, body: Value) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header("authorization", format!("Bearer {TOKEN}"))
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .expect("request should be valid")
}

fn internal_json_request(method: &str, uri: &str, body: Value) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header("x-internal-auth-key", INTERNAL_KEY)
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .expect("request should be valid")
}

fn internal_identity_json_request(method: &str, uri: &str, body: Value) -> Request<Body> {
    Request::builder()
        .method(method)
        .uri(uri)
        .header("x-internal-auth-key", INTERNAL_KEY)
        .header("x-internal-macro-user-id", USER_ID)
        .header("x-internal-fusionauth-user-id", "fusion-user")
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .expect("request should be valid")
}

async fn json_body(response: axum::response::Response) -> Value {
    let bytes = response
        .into_body()
        .collect()
        .await
        .expect("response body should be readable")
        .to_bytes();
    serde_json::from_slice(&bytes).expect("response should be JSON")
}

#[tokio::test]
async fn list_projects_returns_exact_success_envelope() {
    let response = router(FakeProjectService::with_project(USER_ID, false), None)
        .oneshot(authenticated_request("/"))
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        json_body(response).await,
        json!({
            "error": false,
            "data": [{
                "id": PROJECT_ID,
                "name": "Project",
                "userId": USER_ID,
                "createdAt": null,
                "updatedAt": null,
                "deletedAt": null
            }]
        })
    );
}

#[tokio::test]
async fn required_route_rejects_missing_credentials() {
    let request = Request::get("/")
        .body(Body::empty())
        .expect("valid request");
    let response = router(FakeProjectService::with_project(USER_ID, false), None)
        .oneshot(request)
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn preview_allows_anonymous_requests_with_exact_envelope() {
    let request = Request::post("/preview")
        .header("content-type", "application/json")
        .body(Body::from(r#"{"projectIds":["project-1"]}"#))
        .expect("valid request");
    let response = router(FakeProjectService::with_project(USER_ID, false), None)
        .oneshot(request)
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(json_body(response).await, json!({ "previews": [] }));
}

#[tokio::test]
async fn middleware_returns_generic_404_envelope() {
    let response = router(FakeProjectService::missing(), None)
        .oneshot(authenticated_request(&format!("/{PROJECT_ID}")))
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        json_body(response).await,
        json!({ "error": true, "message": "project not found: missing" })
    );
}

#[tokio::test]
async fn access_extractor_denial_prevents_handler() {
    let response = router(
        FakeProjectService::with_project("macro|owner@example.com", false),
        None,
    )
    .oneshot(authenticated_request(&format!("/{PROJECT_ID}")))
    .await
    .expect("router should respond");

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn create_returns_project_success_envelope() {
    let response = router(FakeProjectService::with_project(USER_ID, false), None)
        .oneshot(authenticated_json_request(
            "POST",
            "/",
            json!({ "name": "Created", "projectParentId": null }),
        ))
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        json_body(response).await,
        json!({
            "error": false,
            "data": {
                "id": PROJECT_ID,
                "name": "Project",
                "userId": USER_ID,
                "createdAt": null,
                "updatedAt": null,
                "deletedAt": null
            }
        })
    );
}

#[tokio::test]
async fn edit_permission_denial_prevents_mutation() {
    let response = router(
        FakeProjectService::with_project("macro|owner@example.com", false),
        Some(AccessLevel::View),
    )
    .oneshot(authenticated_json_request(
        "PATCH",
        &format!("/{PROJECT_ID}"),
        json!({ "name": "Edited" }),
    ))
    .await
    .expect("router should respond");

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn owner_can_edit_with_exact_success_response() {
    let response = router(FakeProjectService::with_project(USER_ID, false), None)
        .oneshot(authenticated_json_request(
            "PATCH",
            &format!("/{PROJECT_ID}"),
            json!({ "name": "Edited" }),
        ))
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        json_body(response).await,
        json!({ "error": false, "data": { "success": true } })
    );
}

#[tokio::test]
async fn edit_rejects_deleted_project() {
    let response = router(FakeProjectService::with_project(USER_ID, true), None)
        .oneshot(authenticated_json_request(
            "PATCH",
            &format!("/{PROJECT_ID}"),
            json!({ "name": "Edited" }),
        ))
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        json_body(response).await,
        json!({ "error": true, "message": "cannot modify deleted project" })
    );
}

#[tokio::test]
async fn edit_body_parent_denial_prevents_handler() {
    let response = router(FakeProjectService::with_project(USER_ID, false), None)
        .oneshot(authenticated_json_request(
            "PATCH",
            &format!("/{PROJECT_ID}"),
            json!({ "projectParentId": Uuid::new_v4().to_string() }),
        ))
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn owner_can_delete_with_exact_response_body() {
    let response = router(FakeProjectService::with_project(USER_ID, false), None)
        .oneshot(authenticated_json_request(
            "DELETE",
            &format!("/{PROJECT_ID}"),
            json!({}),
        ))
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        json_body(response).await,
        json!({
            "error": false,
            "data": {
                "project_ids": [PROJECT_ID],
                "document_ids": ["document-1"],
                "chat_ids": ["chat-1"]
            }
        })
    );
}

#[tokio::test]
async fn deleted_project_creator_can_revert() {
    let response = router(FakeProjectService::with_project(USER_ID, true), None)
        .oneshot(authenticated_json_request(
            "PUT",
            &format!("/{PROJECT_ID}/revert_delete"),
            json!({}),
        ))
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        json_body(response).await,
        json!({ "error": false, "data": { "success": true } })
    );
}

#[tokio::test]
async fn internal_actor_can_revert_deleted_project() {
    let response = router(
        FakeProjectService::with_project("macro|owner@example.com", true),
        None,
    )
    .oneshot(internal_json_request(
        "PUT",
        &format!("/{PROJECT_ID}/revert_delete"),
        json!({}),
    ))
    .await
    .expect("router should respond");

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        json_body(response).await,
        json!({ "error": false, "data": { "success": true } })
    );
}

#[tokio::test]
async fn soft_deleted_project_rejects_non_owner_even_with_shared_access() {
    let response = router(
        FakeProjectService::with_project("macro|owner@example.com", true),
        Some(AccessLevel::View),
    )
    .oneshot(authenticated_request(&format!(
        "/{PROJECT_ID}/access_level"
    )))
    .await
    .expect("router should respond");

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        json_body(response).await,
        json!({ "message": "only owner can access deleted resource" })
    );
}

#[tokio::test]
async fn upload_with_parent_denial_prevents_service_call() {
    let service = FakeProjectService::with_project(USER_ID, false);
    let calls = service.upload_internal_flags.clone();
    let response = router(service, None)
        .oneshot(authenticated_json_request(
            "POST",
            "/upload",
            json!({
                "content": [],
                "rootFolderName": "Folder",
                "uploadRequestId": "request-1",
                "parentId": Uuid::new_v4().to_string()
            }),
        ))
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert!(calls.lock().expect("upload flag lock poisoned").is_empty());
}

#[tokio::test]
async fn upload_extract_with_parent_denial_prevents_service_call() {
    let response = router(FakeProjectService::with_project(USER_ID, false), None)
        .oneshot(authenticated_json_request(
            "POST",
            "/upload_extract",
            json!({
                "sha": "archive-sha",
                "parentId": Uuid::new_v4().to_string()
            }),
        ))
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn anonymous_upload_is_rejected() {
    let request = Request::post("/upload")
        .header("content-type", "application/json")
        .body(Body::from(
            json!({
                "content": [],
                "rootFolderName": "Folder",
                "uploadRequestId": "request-1"
            })
            .to_string(),
        ))
        .expect("request should be valid");
    let response = router(FakeProjectService::with_project(USER_ID, false), None)
        .oneshot(request)
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn internal_upload_selects_internal_destinations_with_exact_lambda_json() {
    let service = FakeProjectService::with_project(USER_ID, false);
    let flags = service.upload_internal_flags.clone();
    let response = router(service, None)
        .oneshot(internal_identity_json_request(
            "POST",
            "/upload",
            json!({
                "content": [],
                "rootFolderName": "Folder",
                "uploadRequestId": "lambda-request"
            }),
        ))
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(&*flags.lock().expect("upload flag lock poisoned"), &[true]);
    assert_eq!(
        json_body(response).await,
        json!({
            "error": false,
            "data": {
                "fileSystem": {
                    "type": "folder",
                    "content": {},
                    "project_id": PROJECT_ID
                },
                "destinationMap": {}
            }
        })
    );
}

#[tokio::test]
async fn permanent_delete_forwards_loaded_project() {
    let service = FakeProjectService::with_project(USER_ID, true);
    let expected_project = service
        .basic_project
        .lock()
        .expect("basic project lock poisoned")
        .as_ref()
        .expect("project should exist")
        .clone();
    let deleted_projects = service.permanently_deleted_projects.clone();
    let response = router(service, Some(AccessLevel::Owner))
        .oneshot(
            Request::delete(format!("/{PROJECT_ID}/permanent"))
                .header("authorization", format!("Bearer {TOKEN}"))
                .body(Body::empty())
                .expect("request should be valid"),
        )
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        *deleted_projects
            .lock()
            .expect("permanently deleted project lock poisoned"),
        vec![expected_project]
    );
}

#[tokio::test]
async fn permanent_delete_requires_owner_access() {
    let service = FakeProjectService::with_project("macro|owner@example.com", true);
    let mutations = service.mutations.clone();
    let response = router(service, Some(AccessLevel::Edit))
        .oneshot(
            Request::delete(format!("/{PROJECT_ID}/permanent"))
                .header("authorization", format!("Bearer {TOKEN}"))
                .body(Body::empty())
                .expect("request should be valid"),
        )
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert!(mutations.lock().expect("mutation lock poisoned").is_empty());
}

#[tokio::test]
async fn mark_uploaded_preserves_exact_lambda_request_and_response_json() {
    use super::upload_folder::mark_uploaded_handler;

    let state = ProjectRouterState {
        service: Arc::new(FakeProjectService::with_project(USER_ID, false)),
        access_service: Arc::new(FakeEntityAccessService { access_level: None }),
        authorization_state: MacroAuthorizationState::new(Arc::new(FakeAuthorizationService)),
    };
    let router = Router::new()
        .route(
            "/mark_uploaded",
            axum::routing::post(
                mark_uploaded_handler::<
                    FakeProjectService,
                    FakeEntityAccessService,
                    FakeAuthorizationService,
                >,
            ),
        )
        .with_state(state);
    let response = router
        .oneshot(internal_identity_json_request(
            "POST",
            "/mark_uploaded",
            json!({ "projectId": PROJECT_ID }),
        ))
        .await
        .expect("router should respond");

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        json_body(response).await,
        json!({ "projectIds": [PROJECT_ID, "project-child"] })
    );
}
