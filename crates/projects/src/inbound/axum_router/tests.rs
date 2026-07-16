use std::sync::{Arc, Mutex};

use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode},
};
use entity_access::domain::{
    models::{
        AccessError, AccessLevel, BotId, CallChannelInfo, EntityAccessReceipt, EntityPermission,
        EntityType, RequiredPermission, UserTeamInfo,
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
    item::ItemWithUserAccessLevel,
    project::{
        BasicProject, PendingProject, Project, ProjectPreview,
        request::{CreateProjectRequest, PatchProjectRequestV2},
        response::GetProjectResponseData,
    },
};
use model_user::UserContext;
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
const USER_ID: &str = "macro|router@example.com";
const PROJECT_ID: &str = "project-1";

#[derive(Clone)]
struct FakeProjectService {
    basic_project: Arc<Mutex<Result<BasicProject, String>>>,
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
        }
    }

    fn missing() -> Self {
        Self {
            basic_project: Arc::new(Mutex::new(Err("missing".to_string()))),
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
        panic!("project creation is not used by these tests")
    }

    async fn edit_project(
        &self,
        _receipt: EntityAccessReceipt<entity_access::domain::models::EditAccessLevel>,
        _project: BasicProject,
        _args: PatchProjectRequestV2,
    ) -> Result<(), ProjectError> {
        panic!("project editing is not used by these tests")
    }

    async fn soft_delete_project(
        &self,
        _receipt: EntityAccessReceipt<entity_access::domain::models::OwnerAccessLevel>,
        _project: BasicProject,
        _actor_user_id: String,
    ) -> Result<SoftDeleteResult, ProjectError> {
        panic!("project deletion is not used by these tests")
    }

    async fn revert_delete_project(
        &self,
        _receipt: EntityAccessReceipt<entity_access::domain::models::OwnerAccessLevel>,
        _project: BasicProject,
    ) -> Result<(), ProjectError> {
        panic!("project restoration is not used by these tests")
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
        panic!("unexpected receipt generation")
    }

    async fn generate_bot_entity_access_receipt<T: RequiredPermission>(
        &self,
        _bot_id: BotId,
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
    ) -> Result<(EntityPermission, Uuid), AccessError> {
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
        _provided_key: &str,
        _claims: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        Err(Report::new(MacroAuthorizationError::InvalidCredentials))
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
