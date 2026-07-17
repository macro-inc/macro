//! Handlers for project folder uploads.

use axum::{Json, extract::State};
use entity_access::domain::{
    models::{EditAccessLevel, EntityType},
    ports::EntityAccessService,
};
use macro_authorization::{MacroAuthorizationExtractor, MacroAuthorizationService};
use model::{
    folder::{UploadFolderRequest, UploadFolderResponseData},
    response::TypedSuccessResponse,
};
use models_bulk_upload::{
    MarkProjectUploadedRequest, MarkProjectUploadedResponse, UploadExtractFolderRequest,
    UploadExtractFolderResponseData,
};

use super::ProjectRouterState;
use crate::domain::{models::ProjectError, ports::ProjectService};

/// Successful folder-upload response.
pub type UploadFolderResponse = TypedSuccessResponse<UploadFolderResponseData>;

/// Successful upload-extract response.
pub type UploadExtractFolderResponse = TypedSuccessResponse<UploadExtractFolderResponseData>;

/// Upload a folder tree and create its upload destinations.
#[utoipa::path(
    post,
    path = "/projects/upload",
    responses(
        (status = 200, body = inline(UploadFolderResponse)),
        (status = 401, body = model::response::GenericErrorResponse),
        (status = 404, body = model::response::GenericErrorResponse),
        (status = 500, body = model::response::GenericErrorResponse),
    )
)]
#[tracing::instrument(skip(state, user, request), fields(user_id=%user.macro_user_id), err)]
pub async fn upload_folder_handler<T, Svc, Auth>(
    State(state): State<ProjectRouterState<T, Svc, Auth>>,
    user: MacroAuthorizationExtractor<Auth>,
    Json(request): Json<UploadFolderRequest>,
) -> Result<Json<UploadFolderResponse>, ProjectError>
where
    T: ProjectService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    ensure_parent_edit_access(&state, &user, request.parent_id.as_deref()).await?;
    let data = state
        .service
        .upload_folder(user.macro_user_id, user.is_internal_access, request)
        .await?;

    Ok(Json(UploadFolderResponse { error: false, data }))
}

/// Create a request for extracting an uploaded folder archive.
#[utoipa::path(
    tag = "project",
    post,
    path = "/projects/upload_extract",
    responses(
        (status = 200, body = inline(UploadExtractFolderResponse)),
        (status = 401, body = model::response::GenericErrorResponse),
        (status = 404, body = model::response::GenericErrorResponse),
        (status = 500, body = model::response::GenericErrorResponse),
    )
)]
#[tracing::instrument(skip(state, user, request), fields(user_id=%user.macro_user_id), err)]
pub async fn upload_extract_folder_handler<T, Svc, Auth>(
    State(state): State<ProjectRouterState<T, Svc, Auth>>,
    user: MacroAuthorizationExtractor<Auth>,
    Json(request): Json<UploadExtractFolderRequest>,
) -> Result<Json<UploadExtractFolderResponse>, ProjectError>
where
    T: ProjectService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    ensure_parent_edit_access(&state, &user, request.parent_id.as_deref()).await?;
    let data = state
        .service
        .create_upload_extract_request(user.macro_user_id, request)
        .await?;

    Ok(Json(UploadExtractFolderResponse { error: false, data }))
}

async fn ensure_parent_edit_access<T, Svc, Auth>(
    state: &ProjectRouterState<T, Svc, Auth>,
    user: &MacroAuthorizationExtractor<Auth>,
    parent_id: Option<&str>,
) -> Result<(), ProjectError>
where
    Svc: EntityAccessService,
{
    let Some(parent_id) = parent_id.filter(|_| !user.is_internal_access) else {
        return Ok(());
    };

    let _receipt = state
        .access_service
        .generate_entity_access_receipt::<EditAccessLevel>(
            &user.macro_user_id,
            user.user_context.organization_id.map(i64::from),
            parent_id,
            EntityType::Project,
        )
        .await
        .map_err(|_| ProjectError::Unauthorized)?;
    Ok(())
}

/// Mark a project tree as uploaded. This handler is mounted only on the internal router.
#[tracing::instrument(skip(state, user, request), fields(user_id=%user.macro_user_id), err)]
pub async fn mark_uploaded_handler<T, Svc, Auth>(
    State(state): State<ProjectRouterState<T, Svc, Auth>>,
    user: MacroAuthorizationExtractor<Auth>,
    Json(request): Json<MarkProjectUploadedRequest>,
) -> Result<Json<MarkProjectUploadedResponse>, ProjectError>
where
    T: ProjectService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let project_ids = state
        .service
        .mark_projects_uploaded(&request.project_id)
        .await?;
    Ok(Json(MarkProjectUploadedResponse { project_ids }))
}
