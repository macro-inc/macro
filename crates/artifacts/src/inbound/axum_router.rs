//! The artifacts API, mounted at `/artifacts`.
//!
//! Every route on an existing artifact copies the sibling document routes'
//! access checks: the artifact document is loaded first, then
//! [`DocumentAccessExtractor`] mints the receipt the service takes. Reads,
//! including `view_url`, admit anonymous public-link viewers.

use std::collections::BTreeMap;
use std::sync::Arc;

use axum::body::Body;
use axum::extract::{
    DefaultBodyLimit, FromRef, FromRequest, FromRequestParts, Path, Request, State,
};
use axum::http::StatusCode;
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::Engine;
use chrono::{DateTime, Utc};
use entity_access::domain::models::{EditAccessLevel, EntityAccessReceipt, ViewAccessLevel};
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::{
    DocumentAccessExtractor, ExtractorError, ProjectBodyAccessLevelExtractorV2,
};
use entity_registry::{CreationPrincipalExtractor, NonUserOwners};
use macro_authorization::{
    AnyPrincipal, MacroAuthorization, MacroAuthorizationExtractor, MacroAuthorizationService,
    MacroAuthorizationState, OptionalMacroAuthorizationExtractor,
};

use model_error_response::ErrorResponse;
use serde::{Deserialize, Serialize};
use utoipa::{OpenApi, ToSchema};

use crate::domain::models::{
    Artifact, ArtifactError, ArtifactVersion, ArtifactVersionSummary, CreateArtifact, FileInput,
    PlaceArtifact, PublishVersion, Publisher, SceneInput, Theme, UploadInput, UploadTarget,
    ViewUrl, ViewUrlRequest,
};
use crate::domain::ports::ArtifactService;

/// Largest create or publish request body. Inline content is for small pages
/// and code mode; large files go through `/uploads`.
pub const MAX_PUBLISH_BODY_BYTES: usize = 32 * 1024 * 1024;

/// Router state for the artifacts API.
pub struct ArtifactsRouterState<Service, EntityAccess, Authorization> {
    service: Arc<Service>,
    entity_access: Arc<EntityAccess>,
    authorization_state: MacroAuthorizationState<Authorization>,
    non_user_owners: NonUserOwners,
}

impl<Service, EntityAccess, Authorization> Clone
    for ArtifactsRouterState<Service, EntityAccess, Authorization>
{
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            entity_access: self.entity_access.clone(),
            authorization_state: self.authorization_state.clone(),
            non_user_owners: self.non_user_owners,
        }
    }
}

impl<Service, EntityAccess, Authorization>
    ArtifactsRouterState<Service, EntityAccess, Authorization>
{
    /// Router state over the artifact service and the host's access services.
    pub fn new(
        service: Arc<Service>,
        entity_access: Arc<EntityAccess>,
        authorization_state: MacroAuthorizationState<Authorization>,
        non_user_owners: NonUserOwners,
    ) -> Self {
        Self {
            service,
            entity_access,
            authorization_state,
            non_user_owners,
        }
    }
}

impl<Service, EntityAccess, Authorization>
    FromRef<ArtifactsRouterState<Service, EntityAccess, Authorization>> for Arc<EntityAccess>
{
    fn from_ref(state: &ArtifactsRouterState<Service, EntityAccess, Authorization>) -> Self {
        state.entity_access.clone()
    }
}

impl<Service, EntityAccess, Authorization>
    FromRef<ArtifactsRouterState<Service, EntityAccess, Authorization>>
    for MacroAuthorizationState<Authorization>
{
    fn from_ref(state: &ArtifactsRouterState<Service, EntityAccess, Authorization>) -> Self {
        state.authorization_state.clone()
    }
}

impl<Service, EntityAccess, Authorization>
    FromRef<ArtifactsRouterState<Service, EntityAccess, Authorization>> for NonUserOwners
{
    fn from_ref(state: &ArtifactsRouterState<Service, EntityAccess, Authorization>) -> Self {
        state.non_user_owners
    }
}

impl IntoResponse for ArtifactError {
    fn into_response(self) -> Response {
        let status = match &self {
            ArtifactError::NotFound(_) => StatusCode::NOT_FOUND,
            ArtifactError::BadRequest(_) => StatusCode::BAD_REQUEST,
            ArtifactError::Forbidden(_) => StatusCode::FORBIDDEN,
            ArtifactError::Conflict { .. } => StatusCode::CONFLICT,
            ArtifactError::Internal(error) => {
                tracing::error!(error = ?error, "artifacts internal error");
                StatusCode::INTERNAL_SERVER_ERROR
            }
        };
        (
            status,
            Json(ErrorResponse {
                message: self.to_string().into(),
            }),
        )
            .into_response()
    }
}

/// Build the artifacts router, nested by the host at `/artifacts`.
pub fn artifacts_router<Service, EntityAccess, Authorization, RouterState>(
    state: ArtifactsRouterState<Service, EntityAccess, Authorization>,
) -> Router<RouterState>
where
    Service: ArtifactService,
    EntityAccess: EntityAccessService,
    Authorization: MacroAuthorizationService,
    RouterState: Send + Sync + 'static,
{
    let artifact_routes = Router::new()
        .route(
            "/{document_id}",
            get(get_artifact_handler::<Service, EntityAccess, Authorization>),
        )
        .route(
            "/{document_id}/uploads",
            post(uploads_handler::<Service, EntityAccess, Authorization>),
        )
        .route(
            "/{document_id}/versions",
            post(publish_handler::<Service, EntityAccess, Authorization>)
                .layer(DefaultBodyLimit::max(MAX_PUBLISH_BODY_BYTES))
                .get(list_versions_handler::<Service, EntityAccess, Authorization>),
        )
        .route(
            "/{document_id}/versions/{number}",
            get(get_version_handler::<Service, EntityAccess, Authorization>),
        )
        .route(
            "/{document_id}/versions/{number}/restore",
            post(restore_handler::<Service, EntityAccess, Authorization>),
        )
        .route(
            "/{document_id}/view_url",
            post(view_url_handler::<Service, EntityAccess, Authorization>),
        )
        .route(
            "/{document_id}/place",
            post(place_handler::<Service, EntityAccess, Authorization>),
        )
        .layer(middleware::from_fn_with_state(
            state.clone(),
            load_artifact_document::<Service, EntityAccess, Authorization>,
        ));

    Router::new()
        .route(
            "/",
            post(create_handler::<Service, EntityAccess, Authorization>)
                .layer(DefaultBodyLimit::max(MAX_PUBLISH_BODY_BYTES)),
        )
        .merge(artifact_routes)
        .with_state(state)
}

#[derive(Deserialize)]
struct DocumentIdPath {
    document_id: String,
}

/// A version route's number. Named, so routes nested under DSS's
/// `/{version}` prefix, which carry that extra parameter, still extract.
#[derive(Deserialize)]
struct VersionPath {
    number: i32,
}

/// Load the artifact document the access extractors read.
async fn load_artifact_document<Service, EntityAccess, Authorization>(
    State(state): State<ArtifactsRouterState<Service, EntityAccess, Authorization>>,
    Path(DocumentIdPath { document_id }): Path<DocumentIdPath>,
    mut request: Request<Body>,
    next: Next,
) -> Response
where
    Service: ArtifactService,
{
    match state.service.load_document(&document_id).await {
        Ok(document) => {
            request.extensions_mut().insert(document);
            next.run(request).await
        }
        Err(error) => error.into_response(),
    }
}

/// A file of a version as sent.
#[derive(Debug, Deserialize, ToSchema)]
pub struct FileInputBody {
    /// Relative `/`-separated path, e.g. `scenes/empty.html`.
    pub path: String,
    /// One of the allowed content types.
    pub content_type: String,
    /// Hex SHA-256 of the bytes.
    pub sha256: String,
    /// The bytes, base64. Omit when the object is already stored for this
    /// artifact (uploaded through `/uploads`, or in an earlier version).
    #[serde(default)]
    pub content_base64: Option<String>,
}

/// A named page of a version.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct SceneBody {
    /// Slug: lowercase letters, digits and dashes.
    pub id: String,
    /// Display title.
    pub title: String,
    /// The page, one of the version's files.
    pub path: String,
}

fn file_inputs(files: Vec<FileInputBody>) -> Result<Vec<FileInput>, ArtifactError> {
    files
        .into_iter()
        .map(|file| {
            let content = file
                .content_base64
                .map(|encoded| {
                    base64::engine::general_purpose::STANDARD
                        .decode(encoded)
                        .map_err(|_| {
                            ArtifactError::BadRequest(format!(
                                "content_base64 of {:?} is not base64",
                                file.path
                            ))
                        })
                })
                .transpose()?;
            Ok(FileInput {
                path: file.path,
                content_type: file.content_type,
                sha256: file.sha256,
                content,
            })
        })
        .collect()
}

fn scene_inputs(scenes: Vec<SceneBody>) -> Vec<SceneInput> {
    scenes
        .into_iter()
        .map(|scene| SceneInput {
            id: scene.id,
            title: scene.title,
            path: scene.path,
        })
        .collect()
}

/// Create an artifact with its first version.
#[derive(Debug, Deserialize, ToSchema)]
pub struct CreateArtifactRequest {
    /// Name.
    pub name: String,
    /// Folder to create it in; needs edit access to it.
    #[serde(default)]
    pub project_id: Option<uuid::Uuid>,
    /// Files of version 1, each with its content. Omit to create the
    /// artifact without a version, upload through `/uploads`, then publish.
    #[serde(default)]
    pub files: Vec<FileInputBody>,
    /// Scenes.
    #[serde(default)]
    pub scenes: Vec<SceneBody>,
    /// What it is.
    #[serde(default)]
    pub message: Option<String>,
}

/// Publish a version.
#[derive(Debug, Deserialize, ToSchema)]
pub struct PublishVersionRequest {
    /// Files.
    pub files: Vec<FileInputBody>,
    /// Scenes.
    #[serde(default)]
    pub scenes: Vec<SceneBody>,
    /// What changed.
    #[serde(default)]
    pub message: Option<String>,
    /// The version this one builds on, 0 when none is published yet;
    /// publishing fails with 409 when the artifact has moved past it.
    #[serde(default)]
    pub base_version: Option<i32>,
}

/// A file of a version.
#[derive(Debug, Serialize, ToSchema)]
pub struct ArtifactFileResponse {
    /// Path.
    pub path: String,
    /// Hex SHA-256.
    pub sha256: String,
    /// Size in bytes.
    pub size: u64,
    /// Content type.
    pub content_type: String,
}

/// A published version.
#[derive(Debug, Serialize, ToSchema)]
pub struct ArtifactVersionResponse {
    /// 1, 2, 3 … per artifact.
    pub number: i32,
    /// Files by path.
    pub files: Vec<ArtifactFileResponse>,
    /// Scenes in order.
    pub scenes: Vec<SceneBody>,
    /// What changed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    /// The user who published it.
    pub created_by: String,
    /// The bot that published it for them.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_by_agent: Option<String>,
    /// Publish time.
    pub created_at: DateTime<Utc>,
}

impl From<ArtifactVersion> for ArtifactVersionResponse {
    fn from(version: ArtifactVersion) -> Self {
        Self {
            number: version.number,
            files: version
                .manifest
                .files
                .into_iter()
                .map(|(path, file)| ArtifactFileResponse {
                    path: path.as_str().to_string(),
                    sha256: file.sha256.as_str().to_string(),
                    size: file.size,
                    content_type: file.content_type,
                })
                .collect(),
            scenes: version
                .manifest
                .scenes
                .into_iter()
                .map(|scene| SceneBody {
                    id: scene.id.as_str().to_string(),
                    title: scene.title,
                    path: scene.path.as_str().to_string(),
                })
                .collect(),
            message: version.message,
            created_by: version.created_by,
            created_by_agent: version.created_by_agent,
            created_at: version.created_at,
        }
    }
}

/// An artifact with its current version.
#[derive(Debug, Serialize, ToSchema)]
pub struct ArtifactResponse {
    /// The artifact document.
    pub document_id: String,
    /// Name.
    pub name: String,
    /// Owner.
    pub owner: String,
    /// The current version; null until the first publish.
    #[schema(required = true)]
    pub current: Option<ArtifactVersionResponse>,
}

impl From<Artifact> for ArtifactResponse {
    fn from(artifact: Artifact) -> Self {
        Self {
            document_id: artifact.document_id,
            name: artifact.name,
            owner: artifact.owner,
            current: artifact.current.map(Into::into),
        }
    }
}

/// A version in the history.
#[derive(Debug, Serialize, ToSchema)]
pub struct ArtifactVersionSummaryResponse {
    /// Version number.
    pub number: i32,
    /// What changed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    /// The user who published it.
    pub created_by: String,
    /// The bot that published it for them.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub created_by_agent: Option<String>,
    /// Publish time.
    pub created_at: DateTime<Utc>,
    /// Number of files.
    pub file_count: usize,
    /// All files' bytes together.
    pub total_size: u64,
}

impl From<ArtifactVersionSummary> for ArtifactVersionSummaryResponse {
    fn from(summary: ArtifactVersionSummary) -> Self {
        Self {
            number: summary.number,
            message: summary.message,
            created_by: summary.created_by,
            created_by_agent: summary.created_by_agent,
            created_at: summary.created_at,
            file_count: summary.file_count,
            total_size: summary.total_size,
        }
    }
}

/// Version history.
#[derive(Debug, Serialize, ToSchema)]
pub struct ArtifactVersionsResponse {
    /// Newest first.
    pub versions: Vec<ArtifactVersionSummaryResponse>,
}

/// An object to upload.
#[derive(Debug, Deserialize, ToSchema)]
pub struct UploadFileBody {
    /// Hex SHA-256 of the bytes.
    pub sha256: String,
    /// Size in bytes.
    pub size: u64,
    /// Content type.
    pub content_type: String,
}

/// Objects a publisher wants to upload.
#[derive(Debug, Deserialize, ToSchema)]
pub struct ArtifactUploadsRequest {
    /// The objects.
    pub files: Vec<UploadFileBody>,
}

/// Where to `PUT` one object.
#[derive(Debug, Serialize, ToSchema)]
pub struct ArtifactUploadResponse {
    /// The object's digest.
    pub sha256: String,
    /// Presigned URL.
    pub url: String,
    /// Headers the `PUT` must carry.
    pub headers: BTreeMap<String, String>,
}

impl From<UploadTarget> for ArtifactUploadResponse {
    fn from(target: UploadTarget) -> Self {
        Self {
            sha256: target.sha256.as_str().to_string(),
            url: target.url,
            headers: target.headers,
        }
    }
}

/// Uploads for the objects not yet stored. Stored ones are left out.
#[derive(Debug, Serialize, ToSchema)]
pub struct ArtifactUploadsResponse {
    /// One per missing object.
    pub uploads: Vec<ArtifactUploadResponse>,
}

/// Color scheme for the rendered page.
#[derive(Debug, Clone, Copy, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum ArtifactTheme {
    /// Light.
    Light,
    /// Dark.
    Dark,
}

/// Ask for a URL rendering a version.
#[derive(Debug, Default, Deserialize, ToSchema)]
pub struct ArtifactViewUrlRequest {
    /// Version; the current one when omitted.
    #[serde(default)]
    pub version: Option<i32>,
    /// Scene to open instead of `index.html`.
    #[serde(default)]
    pub scene: Option<String>,
    /// Color scheme, passed to the page as `?theme=`.
    #[serde(default)]
    pub theme: Option<ArtifactTheme>,
}

/// A URL rendering a version on the artifact's own origin.
#[derive(Debug, Serialize, ToSchema)]
pub struct ArtifactViewUrlResponse {
    /// The URL, for an iframe `src`.
    pub url: String,
    /// The artifact's origin; frame messages must come from exactly this.
    pub origin: String,
    /// The version it renders.
    pub version: i32,
    /// When the URL stops working.
    pub expires_at: DateTime<Utc>,
}

impl From<ViewUrl> for ArtifactViewUrlResponse {
    fn from(view_url: ViewUrl) -> Self {
        Self {
            url: view_url.url,
            origin: view_url.origin,
            version: view_url.version,
            expires_at: view_url.expires_at,
        }
    }
}

/// The create body with its folder access checked. The shared project body
/// extractor reads the folder from `projectId`; this API spells it
/// `project_id`, so the extractor is handed that spelling.
pub struct CreateArtifactBody<EntityAccess, Authorization>(
    pub CreateArtifactRequest,
    std::marker::PhantomData<(EntityAccess, Authorization)>,
);

impl<RouterState, EntityAccess, Authorization> FromRequest<RouterState>
    for CreateArtifactBody<EntityAccess, Authorization>
where
    Arc<EntityAccess>: FromRef<RouterState>,
    EntityAccess: EntityAccessService,
    MacroAuthorizationState<Authorization>: FromRef<RouterState>,
    Authorization: MacroAuthorizationService,
    RouterState: Send + Sync + 'static,
{
    type Rejection = Response;

    async fn from_request(request: Request, state: &RouterState) -> Result<Self, Self::Rejection> {
        let (parts, body) = request.into_parts();
        let Json(mut json) = Json::<serde_json::Value>::from_request(
            Request::from_parts(parts.clone(), body),
            state,
        )
        .await
        .map_err(IntoResponse::into_response)?;

        if let Some(object) = json.as_object_mut() {
            object.remove("projectId");
            object.remove("projectParentId");
            if let Some(project_id) = object.get("project_id").cloned() {
                object.insert("projectId".to_string(), project_id);
            }
        }

        let body = serde_json::to_vec(&json)
            .map_err(|_| ExtractorError::BadRequest("Invalid JSON body").into_response())?;
        let checked = ProjectBodyAccessLevelExtractorV2::<
            EditAccessLevel,
            CreateArtifactRequest,
            EntityAccess,
            Authorization,
        >::from_request(Request::from_parts(parts, Body::from(body)), state)
        .await
        .map_err(IntoResponse::into_response)?;

        Ok(Self(checked.into_inner(), std::marker::PhantomData))
    }
}

/// The publisher a caller is: its user, and the bot or the signed agent
/// attribution acting for them. Every version names a user.
fn publisher_of(authorization: &MacroAuthorization) -> Result<Publisher, ArtifactError> {
    let no_user =
        || ArtifactError::Forbidden("publishing an artifact needs an acting user".to_string());
    match authorization {
        MacroAuthorization::User(user) | MacroAuthorization::Internal(Some(user)) => {
            Ok(Publisher {
                user_id: user.macro_user_id.to_string(),
                agent: user
                    .agent_id
                    .map(|agent| agent.into_storage_id().to_string()),
            })
        }
        MacroAuthorization::Bot(bot) => {
            let user = bot.acting_user.as_ref().ok_or_else(no_user)?;
            Ok(Publisher {
                user_id: user.macro_user_id.to_string(),
                agent: Some(bot.bot_id.into_storage_id().to_string()),
            })
        }
        MacroAuthorization::Internal(None) | MacroAuthorization::Harness(_) => Err(no_user()),
    }
}

/// Create an artifact: a document of file type `artifact`, and its version 1
/// when files are given.
#[utoipa::path(
    tag = "artifacts",
    post,
    path = "/artifacts",
    operation_id = "create_artifact",
    request_body = CreateArtifactRequest,
    responses(
        (status = 201, body = ArtifactResponse),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip_all)]
pub async fn create_handler<Service, EntityAccess, Authorization>(
    State(state): State<ArtifactsRouterState<Service, EntityAccess, Authorization>>,
    caller: MacroAuthorizationExtractor<Authorization, AnyPrincipal>,
    CreationPrincipalExtractor { principal, .. }: CreationPrincipalExtractor<Authorization>,
    CreateArtifactBody(request, _): CreateArtifactBody<EntityAccess, Authorization>,
) -> Result<(StatusCode, Json<ArtifactResponse>), ArtifactError>
where
    Service: ArtifactService,
    EntityAccess: EntityAccessService,
    Authorization: MacroAuthorizationService,
{
    let publisher = publisher_of(&caller.authorization)?;
    let artifact = state
        .service
        .create(
            &principal,
            &publisher,
            CreateArtifact {
                name: request.name,
                project_id: request.project_id,
                files: file_inputs(request.files)?,
                scenes: scene_inputs(request.scenes),
                message: request.message,
            },
        )
        .await?;
    Ok((StatusCode::CREATED, Json(artifact.into())))
}

/// Presigned uploads for the objects not yet stored for this artifact.
#[utoipa::path(
    tag = "artifacts",
    post,
    path = "/artifacts/{document_id}/uploads",
    operation_id = "create_artifact_uploads",
    params(("document_id" = String, Path, description = "Artifact document ID")),
    request_body = ArtifactUploadsRequest,
    responses(
        (status = 200, body = ArtifactUploadsResponse),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip_all)]
pub async fn uploads_handler<Service, EntityAccess, Authorization>(
    State(state): State<ArtifactsRouterState<Service, EntityAccess, Authorization>>,
    access: DocumentAccessExtractor<EditAccessLevel, EntityAccess, Authorization>,
    Json(request): Json<ArtifactUploadsRequest>,
) -> Result<Json<ArtifactUploadsResponse>, ArtifactError>
where
    Service: ArtifactService,
    EntityAccess: EntityAccessService,
    Authorization: MacroAuthorizationService,
{
    let uploads = state
        .service
        .uploads(
            access.entity_access_receipt,
            request
                .files
                .into_iter()
                .map(|file| UploadInput {
                    sha256: file.sha256,
                    size: file.size,
                    content_type: file.content_type,
                })
                .collect(),
        )
        .await?;
    Ok(Json(ArtifactUploadsResponse {
        uploads: uploads.into_iter().map(Into::into).collect(),
    }))
}

/// Publish a new version.
#[utoipa::path(
    tag = "artifacts",
    post,
    path = "/artifacts/{document_id}/versions",
    operation_id = "publish_artifact_version",
    params(("document_id" = String, Path, description = "Artifact document ID")),
    request_body = PublishVersionRequest,
    responses(
        (status = 201, body = ArtifactVersionResponse),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 409, description = "The artifact moved past `base_version`", body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip_all)]
pub async fn publish_handler<Service, EntityAccess, Authorization>(
    State(state): State<ArtifactsRouterState<Service, EntityAccess, Authorization>>,
    access: DocumentAccessExtractor<EditAccessLevel, EntityAccess, Authorization>,
    caller: MacroAuthorizationExtractor<Authorization, AnyPrincipal>,
    Json(request): Json<PublishVersionRequest>,
) -> Result<(StatusCode, Json<ArtifactVersionResponse>), ArtifactError>
where
    Service: ArtifactService,
    EntityAccess: EntityAccessService,
    Authorization: MacroAuthorizationService,
{
    let publisher = publisher_of(&caller.authorization)?;
    let version = state
        .service
        .publish(
            access.entity_access_receipt,
            &publisher,
            PublishVersion {
                files: file_inputs(request.files)?,
                scenes: scene_inputs(request.scenes),
                message: request.message,
                base_version: request.base_version,
            },
        )
        .await?;
    Ok((StatusCode::CREATED, Json(version.into())))
}

/// The artifact with its current version.
#[utoipa::path(
    tag = "artifacts",
    get,
    path = "/artifacts/{document_id}",
    operation_id = "get_artifact",
    params(("document_id" = String, Path, description = "Artifact document ID")),
    responses(
        (status = 200, body = ArtifactResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip_all)]
pub async fn get_artifact_handler<Service, EntityAccess, Authorization>(
    State(state): State<ArtifactsRouterState<Service, EntityAccess, Authorization>>,
    access: DocumentAccessExtractor<ViewAccessLevel, EntityAccess, Authorization>,
) -> Result<Json<ArtifactResponse>, ArtifactError>
where
    Service: ArtifactService,
    EntityAccess: EntityAccessService,
    Authorization: MacroAuthorizationService,
{
    let artifact = state.service.get(access.entity_access_receipt).await?;
    Ok(Json(artifact.into()))
}

/// Version history, newest first.
#[utoipa::path(
    tag = "artifacts",
    get,
    path = "/artifacts/{document_id}/versions",
    operation_id = "list_artifact_versions",
    params(("document_id" = String, Path, description = "Artifact document ID")),
    responses(
        (status = 200, body = ArtifactVersionsResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip_all)]
pub async fn list_versions_handler<Service, EntityAccess, Authorization>(
    State(state): State<ArtifactsRouterState<Service, EntityAccess, Authorization>>,
    access: DocumentAccessExtractor<ViewAccessLevel, EntityAccess, Authorization>,
) -> Result<Json<ArtifactVersionsResponse>, ArtifactError>
where
    Service: ArtifactService,
    EntityAccess: EntityAccessService,
    Authorization: MacroAuthorizationService,
{
    let versions = state.service.versions(access.entity_access_receipt).await?;
    Ok(Json(ArtifactVersionsResponse {
        versions: versions.into_iter().map(Into::into).collect(),
    }))
}

/// One version.
#[utoipa::path(
    tag = "artifacts",
    get,
    path = "/artifacts/{document_id}/versions/{number}",
    operation_id = "get_artifact_version",
    params(
        ("document_id" = String, Path, description = "Artifact document ID"),
        ("number" = i32, Path, description = "Version number"),
    ),
    responses(
        (status = 200, body = ArtifactVersionResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip_all)]
pub async fn get_version_handler<Service, EntityAccess, Authorization>(
    State(state): State<ArtifactsRouterState<Service, EntityAccess, Authorization>>,
    access: DocumentAccessExtractor<ViewAccessLevel, EntityAccess, Authorization>,
    Path(VersionPath { number }): Path<VersionPath>,
) -> Result<Json<ArtifactVersionResponse>, ArtifactError>
where
    Service: ArtifactService,
    EntityAccess: EntityAccessService,
    Authorization: MacroAuthorizationService,
{
    let version = state
        .service
        .version(access.entity_access_receipt, number)
        .await?;
    Ok(Json(version.into()))
}

/// Publish an old version again as the newest one.
#[utoipa::path(
    tag = "artifacts",
    post,
    path = "/artifacts/{document_id}/versions/{number}/restore",
    operation_id = "restore_artifact_version",
    params(
        ("document_id" = String, Path, description = "Artifact document ID"),
        ("number" = i32, Path, description = "Version to restore"),
    ),
    responses(
        (status = 201, body = ArtifactVersionResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 409, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip_all)]
pub async fn restore_handler<Service, EntityAccess, Authorization>(
    State(state): State<ArtifactsRouterState<Service, EntityAccess, Authorization>>,
    access: DocumentAccessExtractor<EditAccessLevel, EntityAccess, Authorization>,
    caller: MacroAuthorizationExtractor<Authorization, AnyPrincipal>,
    Path(VersionPath { number }): Path<VersionPath>,
) -> Result<(StatusCode, Json<ArtifactVersionResponse>), ArtifactError>
where
    Service: ArtifactService,
    EntityAccess: EntityAccessService,
    Authorization: MacroAuthorizationService,
{
    let publisher = publisher_of(&caller.authorization)?;
    let version = state
        .service
        .restore(access.entity_access_receipt, &publisher, number)
        .await?;
    Ok((StatusCode::CREATED, Json(version.into())))
}

/// Harness credentials act for no viewer, so they get no view URL.
fn reject_harness(authorization: Option<&MacroAuthorization>) -> Result<(), ArtifactError> {
    match authorization {
        Some(MacroAuthorization::Harness(_)) => Err(ArtifactError::Forbidden(
            "harness credentials cannot view artifacts".to_string(),
        )),
        None
        | Some(MacroAuthorization::User(_))
        | Some(MacroAuthorization::Bot(_))
        | Some(MacroAuthorization::Internal(_)) => Ok(()),
    }
}

/// A URL rendering a version (or one scene) on the artifact's own origin.
#[utoipa::path(
    tag = "artifacts",
    post,
    path = "/artifacts/{document_id}/view_url",
    operation_id = "get_artifact_view_url",
    params(("document_id" = String, Path, description = "Artifact document ID")),
    request_body = ArtifactViewUrlRequest,
    responses(
        (status = 200, body = ArtifactViewUrlResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip_all)]
pub async fn view_url_handler<Service, EntityAccess, Authorization>(
    State(state): State<ArtifactsRouterState<Service, EntityAccess, Authorization>>,
    caller: OptionalMacroAuthorizationExtractor<Authorization, AnyPrincipal>,
    access: DocumentAccessExtractor<ViewAccessLevel, EntityAccess, Authorization>,
    Json(request): Json<ArtifactViewUrlRequest>,
) -> Result<Json<ArtifactViewUrlResponse>, ArtifactError>
where
    Service: ArtifactService,
    EntityAccess: EntityAccessService,
    Authorization: MacroAuthorizationService,
{
    reject_harness(caller.authorization.as_ref())?;
    let view_url = state
        .service
        .view_url(
            access.entity_access_receipt,
            ViewUrlRequest {
                version: request.version,
                scene: request.scene,
                theme: request.theme.map(|theme| match theme {
                    ArtifactTheme::Light => Theme::Light,
                    ArtifactTheme::Dark => Theme::Dark,
                }),
            },
        )
        .await?;
    Ok(Json(view_url.into()))
}

/// Place an artifact, or one of its scenes, on a canvas.
#[derive(Debug, Deserialize, ToSchema)]
pub struct PlaceArtifactRequest {
    /// The node's canvas item id. Retry a placement with the same id to get
    /// one node and one reference; a new id when omitted.
    #[serde(default)]
    pub item_id: Option<uuid::Uuid>,
    /// The canvas document; needs edit access to it.
    pub canvas_id: String,
    /// Scene to show instead of `index.html`; it must exist in the current
    /// version.
    #[serde(default)]
    pub scene: Option<String>,
    /// World x of the node's top-left corner.
    pub x: f64,
    /// World y of the node's top-left corner.
    pub y: f64,
    /// Node width.
    pub width: f64,
    /// Node height.
    pub height: f64,
}

/// The node an artifact was placed as.
#[derive(Debug, Serialize, ToSchema)]
pub struct PlaceArtifactResponse {
    /// The canvas item id of the node.
    pub item_id: uuid::Uuid,
}

/// The place body with edit access to its canvas checked by the same
/// [`DocumentAccessExtractor`] as every document route, run against the
/// canvas document instead of the artifact.
pub struct PlaceArtifactBody<EntityAccess, Authorization> {
    /// The request.
    pub request: PlaceArtifactRequest,
    /// Edit access to the canvas.
    pub canvas: EntityAccessReceipt<EditAccessLevel>,
    _marker: std::marker::PhantomData<(EntityAccess, Authorization)>,
}

impl<Service, EntityAccess, Authorization>
    FromRequest<ArtifactsRouterState<Service, EntityAccess, Authorization>>
    for PlaceArtifactBody<EntityAccess, Authorization>
where
    Service: ArtifactService,
    EntityAccess: EntityAccessService,
    Authorization: MacroAuthorizationService,
{
    type Rejection = Response;

    async fn from_request(
        request: Request,
        state: &ArtifactsRouterState<Service, EntityAccess, Authorization>,
    ) -> Result<Self, Self::Rejection> {
        let (mut parts, body) = request.into_parts();
        let Json(request) = Json::<PlaceArtifactRequest>::from_request(
            Request::from_parts(parts.clone(), body),
            state,
        )
        .await
        .map_err(IntoResponse::into_response)?;

        let canvas = state
            .service
            .load_canvas(&request.canvas_id)
            .await
            .map_err(IntoResponse::into_response)?;
        parts.extensions.insert(canvas);
        let access = DocumentAccessExtractor::<EditAccessLevel, EntityAccess, Authorization>::from_request_parts(
            &mut parts, state,
        )
        .await
        .map_err(IntoResponse::into_response)?;

        Ok(Self {
            request,
            canvas: access.entity_access_receipt,
            _marker: std::marker::PhantomData,
        })
    }
}

/// Place the artifact, or one of its scenes, on a canvas as an embedded
/// document node, recording the canvas's reference to it like the canvas UI
/// does.
#[utoipa::path(
    tag = "artifacts",
    post,
    path = "/artifacts/{document_id}/place",
    operation_id = "place_artifact",
    params(("document_id" = String, Path, description = "Artifact document ID")),
    request_body = PlaceArtifactRequest,
    responses(
        (status = 201, body = PlaceArtifactResponse),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip_all)]
pub async fn place_handler<Service, EntityAccess, Authorization>(
    State(state): State<ArtifactsRouterState<Service, EntityAccess, Authorization>>,
    access: DocumentAccessExtractor<ViewAccessLevel, EntityAccess, Authorization>,
    caller: MacroAuthorizationExtractor<Authorization, AnyPrincipal>,
    body: PlaceArtifactBody<EntityAccess, Authorization>,
) -> Result<(StatusCode, Json<PlaceArtifactResponse>), ArtifactError>
where
    Service: ArtifactService,
    EntityAccess: EntityAccessService,
    Authorization: MacroAuthorizationService,
{
    let publisher = publisher_of(&caller.authorization)?;
    let PlaceArtifactBody {
        request, canvas, ..
    } = body;
    let placement = state
        .service
        .place(
            access.entity_access_receipt,
            canvas,
            &publisher,
            PlaceArtifact {
                item_id: request.item_id,
                scene: request.scene,
                x: request.x,
                y: request.y,
                width: request.width,
                height: request.height,
            },
        )
        .await?;
    Ok((
        StatusCode::CREATED,
        Json(PlaceArtifactResponse {
            item_id: placement.item_id,
        }),
    ))
}

/// The artifacts endpoints and their schemas, for the host's OpenAPI document.
#[derive(OpenApi)]
#[openapi(
    paths(
        create_handler,
        uploads_handler,
        publish_handler,
        get_artifact_handler,
        list_versions_handler,
        get_version_handler,
        restore_handler,
        view_url_handler,
        place_handler,
    ),
    components(schemas(
        CreateArtifactRequest,
        PublishVersionRequest,
        FileInputBody,
        SceneBody,
        ArtifactFileResponse,
        ArtifactVersionResponse,
        ArtifactResponse,
        ArtifactVersionSummaryResponse,
        ArtifactVersionsResponse,
        UploadFileBody,
        ArtifactUploadsRequest,
        ArtifactUploadResponse,
        ArtifactUploadsResponse,
        ArtifactTheme,
        ArtifactViewUrlRequest,
        ArtifactViewUrlResponse,
        PlaceArtifactRequest,
        PlaceArtifactResponse,
    )),
    tags((name = "artifacts", description = "Agent-published web pages"))
)]
pub struct ArtifactsApi;
