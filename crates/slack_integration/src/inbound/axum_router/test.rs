use super::*;
use crate::domain::models::*;
use axum::{
    body::{Body, to_bytes},
    http::Request,
};
use entity_access::domain::models::{
    AccessError, AccessLevel, AdminTeamRole, BotAccessScope, BotId, CallChannelInfo,
    EntityAccessReceipt, EntityPermission, EntityType, RequiredPermission, TeamRole, UserTeamInfo,
};
use macro_authorization::{InternalIdentityClaims, MacroAuthorizationError};
use macro_user_id::{
    lowercased::Lowercase,
    user_id::{MacroUserId, MacroUserIdStr},
};
use model_user::UserContext;
use rootcause::Report;
use serde_json::{Value, json};
use std::sync::atomic::{AtomicUsize, Ordering};
use tower::ServiceExt;
use utoipa::OpenApi;
use uuid::Uuid;

const TEAM: &str = "01900000-0000-7000-8000-000000000001";
const JOB: &str = "01900000-0000-7000-8000-000000000002";
const FOREIGN_JOB: &str = "01900000-0000-7000-8000-000000000003";
const USER: &str = "macro|admin@example.com";

#[derive(Clone)]
struct Auth;
impl MacroAuthorizationService for Auth {
    async fn authorize(&self, jwt: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        if jwt != "valid" {
            return Err(MacroAuthorizationError::InvalidCredentials.into());
        }
        Ok(UserContext {
            user_id: USER.into(),
            fusion_user_id: "fusion-admin".into(),
            permissions: None,
            organization_id: None,
        })
    }
    async fn authorize_internal(
        &self,
        _: &str,
        _: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        Err(MacroAuthorizationError::InvalidCredentials.into())
    }
}

#[derive(Clone)]
struct Access(TeamRole);
impl EntityAccessService for Access {
    async fn get_user_team(
        &self,
        _: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Option<UserTeamInfo>, AccessError> {
        Ok(Some(UserTeamInfo {
            team_id: TEAM.parse().unwrap(),
            role: self.0,
        }))
    }
    async fn generate_entity_access_receipt<P: RequiredPermission>(
        &self,
        _: &MacroUserId<Lowercase<'_>>,
        _: Option<i64>,
        _: &str,
        _: EntityType,
    ) -> Result<EntityAccessReceipt<P>, AccessError> {
        unreachable!()
    }
    async fn generate_bot_entity_access_receipt<P: RequiredPermission>(
        &self,
        _: BotId,
        _: BotAccessScope,
        _: &str,
        _: EntityType,
    ) -> Result<EntityAccessReceipt<P>, AccessError> {
        unreachable!()
    }
    async fn get_access_level(
        &self,
        _: Option<&MacroUserId<Lowercase<'_>>>,
        _: &str,
        _: EntityType,
    ) -> Result<Option<AccessLevel>, AccessError> {
        unreachable!()
    }
    async fn check_access(
        &self,
        _: Option<&MacroUserId<Lowercase<'_>>>,
        _: &str,
        _: EntityType,
        _: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        unreachable!()
    }
    async fn check_public_access(
        &self,
        _: &str,
        _: EntityType,
        _: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        unreachable!()
    }
    async fn get_entity_permission(
        &self,
        _: Option<&MacroUserId<Lowercase<'_>>>,
        _: &str,
        _: EntityType,
        _: Option<i64>,
    ) -> Result<EntityPermission, AccessError> {
        unreachable!()
    }
    async fn get_crm_entity_permission_with_team(
        &self,
        _: Option<&MacroUserId<Lowercase<'_>>>,
        _: &str,
        _: EntityType,
    ) -> Result<(EntityPermission, Uuid, TeamRole), AccessError> {
        unreachable!()
    }
    async fn get_users_by_entity(
        &self,
        _: &str,
        _: EntityType,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        unreachable!()
    }
    async fn get_call_channel(&self, _: &Uuid) -> Result<Option<CallChannelInfo>, AccessError> {
        unreachable!()
    }
    async fn get_call_channel_by_channel_id(
        &self,
        _: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        unreachable!()
    }
}

#[derive(Default)]
struct Service(AtomicUsize, std::sync::Mutex<Option<CreateImport>>);
impl Service {
    fn receipt(
        &self,
        access: EntityAccessReceipt<AdminTeamRole>,
        job: JobId,
    ) -> Result<ImportProgress, ImportError> {
        assert_eq!(access.entity().entity_id, TEAM);
        assert_eq!(access.get_authenticated_user().unwrap().as_ref(), USER);
        self.0.fetch_add(1, Ordering::SeqCst);
        if job.to_string() != JOB {
            return Err(ImportError::Unavailable);
        }
        Ok(ImportProgress {
            source: SourceIdentity::ConfirmedUnknown,
            include_message_history: false,
            job_id: job,
            status: JobStatus::Uploading,
            revision: 1,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
            registration_closed_at: None,
            users_verified: false,
            limits: ImportLimits::default(),
            conversations: vec![],
        })
    }
}
impl ImportService for Service {
    async fn create(
        &self,
        access: EntityAccessReceipt<AdminTeamRole>,
        command: CreateImport,
    ) -> Result<ImportProgress, ImportError> {
        assert_eq!(command.conversations[0].member_ids[0].as_str(), "U1");
        *self.1.lock().unwrap() = Some(command);
        self.receipt(access, JOB.parse().unwrap())
    }
    async fn register_uploads(
        &self,
        access: EntityAccessReceipt<AdminTeamRole>,
        job: JobId,
        command: RegisterUploads,
    ) -> Result<Vec<UploadGrant>, ImportError> {
        self.receipt(access, job)?;
        Ok(command
            .descriptors
            .into_iter()
            .map(|descriptor| UploadGrant {
                descriptor,
                url: "https://staging.invalid/signed-secret".into(),
                required_headers: Default::default(),
                expires_at: chrono::Utc::now(),
            })
            .collect())
    }
    async fn complete_uploads(
        &self,
        access: EntityAccessReceipt<AdminTeamRole>,
        job: JobId,
        command: CompleteUploads,
    ) -> Result<ImportProgress, ImportError> {
        assert_eq!(command.seal.unwrap().part_count, 0);
        self.receipt(access, job)
    }
    async fn finalize(
        &self,
        access: EntityAccessReceipt<AdminTeamRole>,
        command: JobCommand,
    ) -> Result<ImportProgress, ImportError> {
        self.receipt(access, command.job_id)
    }
    async fn cancel(
        &self,
        access: EntityAccessReceipt<AdminTeamRole>,
        command: JobCommand,
    ) -> Result<ImportProgress, ImportError> {
        self.receipt(access, command.job_id)
    }
    async fn progress(
        &self,
        access: EntityAccessReceipt<AdminTeamRole>,
        command: JobCommand,
    ) -> Result<ImportProgress, ImportError> {
        self.receipt(access, command.job_id)
    }
    async fn list(
        &self,
        access: EntityAccessReceipt<AdminTeamRole>,
        _: Option<JobId>,
    ) -> Result<ImportPage, ImportError> {
        Ok(ImportPage {
            jobs: vec![self.receipt(access, JOB.parse().unwrap())?],
            next_cursor: None,
            limits: ImportLimits::default(),
            source_binding: SourceBinding::ConfirmedUnknown,
        })
    }
}

fn router(role: TeamRole) -> (Router, Arc<Service>) {
    let service = Arc::new(Service::default());
    let router = Router::new().nest(
        "/slack",
        slack_router(SlackRouterState {
            service: service.clone(),
            entity_access_service: Arc::new(Access(role)),
            authorization_state: MacroAuthorizationState::new(Arc::new(Auth)),
        }),
    );
    (router, service)
}

fn request(method: &str, path: &str, authenticated: bool, body: impl Into<Body>) -> Request<Body> {
    let mut builder = Request::builder()
        .method(method)
        .uri(path)
        .header("content-type", "application/json");
    if authenticated {
        builder = builder.header("authorization", "Bearer valid");
    }
    builder.body(body.into()).unwrap()
}

fn operations(job: &str) -> Vec<(&'static str, String)> {
    vec![
        ("POST", "/slack/imports".into()),
        ("GET", "/slack/imports".into()),
        ("GET", format!("/slack/imports/{job}")),
        ("POST", format!("/slack/imports/{job}/uploads")),
        ("POST", format!("/slack/imports/{job}/uploads/complete")),
        ("POST", format!("/slack/imports/{job}/finalize")),
        ("POST", format!("/slack/imports/{job}/cancel")),
    ]
}

fn create_body() -> Value {
    json!({"idempotencyToken": JOB, "source": {"kind": "confirmed_unknown"}, "includeMessageHistory": false,
        "conversations": [{"slackChannelId": "C1", "kind": "public_channel", "name": "general", "folder": "general",
            "memberIds": ["U1"], "creatorId": null, "createdAt": null, "archived": false, "messageCount": null}]})
}

fn seal_body() -> Value {
    json!({"uploads": [], "seal": {"slackChannelId": "C1", "partCount": 0, "manifestSha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"}})
}

#[tokio::test]
async fn all_seven_operations_require_authenticated_team_admin() {
    for (role, authenticated, status) in [
        (TeamRole::Admin, false, StatusCode::UNAUTHORIZED),
        (TeamRole::Member, true, StatusCode::UNAUTHORIZED),
    ] {
        let (app, service) = router(role);
        for (method, path) in operations(JOB) {
            let response = app
                .clone()
                .oneshot(request(method, &path, authenticated, "{}"))
                .await
                .unwrap();
            assert_eq!(response.status(), status, "{method} {path}");
        }
        assert_eq!(service.0.load(Ordering::SeqCst), 0);
    }
}

#[tokio::test]
async fn receipts_metadata_and_seals_are_forwarded() {
    let (app, service) = router(TeamRole::Admin);
    for (method, path) in operations(JOB) {
        let body = if path.ends_with("/complete") {
            seal_body()
        } else if path.ends_with("/uploads") {
            json!({"descriptors": []})
        } else if path == "/slack/imports" && method == "POST" {
            create_body()
        } else {
            json!({})
        };
        let response = app
            .clone()
            .oneshot(request(method, &path, true, body.to_string()))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK, "{path}");
        let body: Value = serde_json::from_slice(
            &to_bytes(response.into_body(), CREATE_BODY_BYTES)
                .await
                .unwrap(),
        )
        .unwrap();
        if method == "GET" && path == "/slack/imports" {
            assert_eq!(body["limits"]["registrationBatch"], 50);
            assert_eq!(body["sourceBinding"]["kind"], "confirmed_unknown");
        }
        if path != "/slack/imports" && !path.ends_with("/uploads") {
            assert_eq!(body["source"]["kind"], "confirmed_unknown");
            assert_eq!(body["includeMessageHistory"], false);
        }
        assert!(!body.to_string().contains("signed-secret"));
    }
    assert_eq!(service.0.load(Ordering::SeqCst), 7);
}

#[tokio::test]
async fn create_http_boundary_preserves_exact_confirmed_metadata_and_options() {
    let (app, service) = router(TeamRole::Admin);
    let mut body = create_body();
    let mut selected = Vec::new();
    for id in ["CA", "CC"] {
        let mut metadata = body["conversations"][0].clone();
        metadata["slackChannelId"] = json!(id);
        metadata["folder"] = json!(id);
        metadata["creatorId"] = json!("U1");
        metadata["createdAt"] = json!("1700000000.000001");
        metadata["archived"] = json!(id == "CC");
        selected.push(metadata);
    }
    body["conversations"] = json!(selected);
    let response = app
        .oneshot(request("POST", "/slack/imports", true, body.to_string()))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        serde_json::to_value(service.1.lock().unwrap().as_ref().unwrap()).unwrap(),
        body
    );
}

#[tokio::test]
async fn foreign_jobs_map_to_nondisclosing_not_found_on_every_job_operation() {
    let (app, _) = router(TeamRole::Admin);
    for (method, path) in operations(FOREIGN_JOB).into_iter().skip(2) {
        let body = if path.ends_with("/complete") {
            seal_body()
        } else {
            json!({"descriptors": []})
        };
        let response = app
            .clone()
            .oneshot(request(method, &path, true, body.to_string()))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND, "{path}");
        assert_eq!(
            to_bytes(response.into_body(), 1024).await.unwrap(),
            "\"unavailable\""
        );
    }
}

#[tokio::test]
async fn route_specific_body_limits_reject_before_service() {
    let (app, service) = router(TeamRole::Admin);
    for (path, limit) in [
        ("/slack/imports".into(), CREATE_BODY_BYTES),
        (format!("/slack/imports/{JOB}/uploads"), UPLOAD_BODY_BYTES),
        (
            format!("/slack/imports/{JOB}/uploads/complete"),
            UPLOAD_BODY_BYTES,
        ),
    ] {
        let response = app
            .clone()
            .oneshot(request("POST", &path, true, " ".repeat(limit + 1)))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE, "{path}");
    }
    assert_eq!(service.0.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn grants_are_uncacheable_and_not_part_of_progress() {
    let (app, _) = router(TeamRole::Admin);
    let response = app.oneshot(request("POST", &format!("/slack/imports/{JOB}/uploads"), true,
        json!({"descriptors": [{"upload": {"kind": "users"}, "sha256": "a".repeat(64), "byteLength": 10, "recordCount": null}]}).to_string())).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["cache-control"], "no-store");
    let body = to_bytes(response.into_body(), 4096).await.unwrap();
    assert!(String::from_utf8_lossy(&body).contains("signed-secret"));
}

#[tokio::test]
async fn disabled_errors_are_explicit_and_distinct_from_missing_jobs() {
    let response = ApiError::from(ImportError::Disabled).into_response();
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(
        to_bytes(response.into_body(), 1024).await.unwrap(),
        "\"disabled\""
    );
    assert_eq!(
        ApiError::from(ImportError::Unavailable)
            .into_response()
            .status(),
        StatusCode::NOT_FOUND,
    );
}

#[test]
fn bounded_dtos_reject_oversized_collections_and_body_supplied_team() {
    let mut body = create_body();
    body["conversations"] = json!(vec![body["conversations"][0].clone(); 2001]);
    assert!(serde_json::from_value::<create::CreateRequest>(body).is_err());
    let mut body = create_body();
    body["teamId"] = json!(TEAM);
    assert!(serde_json::from_value::<create::CreateRequest>(body).is_err());
    assert!(
        serde_json::from_value::<uploads::CompleteRequest>(
            json!({"uploads": vec![json!({"kind": "users"}); 51], "seal": null})
        )
        .is_err()
    );
}

#[test]
fn openapi_registers_all_operations_and_metadata_seal_schemas() {
    let doc = serde_json::to_value(SlackApiDoc::openapi()).unwrap();
    for (method, path) in operations("{job_id}") {
        assert!(doc["paths"][path][method.to_lowercase()].is_object());
    }
    let schemas = &doc["components"]["schemas"];
    assert!(schemas["ConversationMetadata"]["properties"]["memberIds"].is_object());
    assert!(schemas["ConversationSeal"]["properties"]["manifestSha256"].is_object());
    assert!(schemas["ImportPage"]["properties"]["sourceBinding"].is_object());
    for field in ["name", "kind", "archived"] {
        assert!(schemas["ConversationProgress"]["properties"][field].is_object());
    }
    for field in ["source", "includeMessageHistory"] {
        assert!(schemas["ImportProgress"]["properties"][field].is_object());
    }
    // Utoipa does not infer serde's rename_all_fields for enum payloads.
    for (name, variant, fields) in [
        ("SourceIdentity", 0, vec!["sourceId"]),
        ("SourceBinding", 2, vec!["sourceId"]),
        ("UploadId", 1, vec!["slackChannelId", "partIndex"]),
        ("SearchState", 2, vec!["receiptId"]),
    ] {
        let properties = &schemas[name]["oneOf"][variant]["properties"];
        for field in fields {
            assert!(properties[field].is_object(), "{name}.{field}");
        }
    }
    assert_eq!(schemas["SlackTimestamp"]["type"], "string");
    assert!(schemas["ImportProgress"]["properties"].get("url").is_none());
}
