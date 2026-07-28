//! Handler for soft-deleting projects.

use axum::{Extension, Json, extract::State};
use entity_access::{
    domain::{models::OwnerAccessLevel, ports::EntityAccessService},
    inbound::axum_extractors::ProjectAccessLevelExtractor,
};
use macro_authorization::{MacroAuthorizationExtractor, MacroAuthorizationService, UserOrInternal};
use model::project::BasicProject;
use model::response::{GenericSuccessResponse, SuccessResponse, TypedSuccessResponse};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use super::ProjectRouterState;
use crate::domain::{models::ProjectError, ports::ProjectService};

/// Identifiers affected by a recursive project soft deletion.
#[derive(Debug, Deserialize, Serialize, ToSchema)]
pub struct ProjectDeleteResponseData {
    /// Deleted projects, including the requested root.
    pub project_ids: Vec<String>,
    /// Deleted documents.
    pub document_ids: Vec<String>,
    /// Deleted chats.
    pub chat_ids: Vec<String>,
}

/// Successful project deletion response.
pub type ProjectDeleteResponse = TypedSuccessResponse<ProjectDeleteResponseData>;

/// Soft-delete a project and all of its children.
#[utoipa::path(
    tag = "project",
    delete,
    path = "/projects/{id}",
    params(("id" = String, Path, description = "ID of the project")),
    responses(
        (status = 200, body = inline(ProjectDeleteResponse)),
        (status = 401, body = model::response::GenericErrorResponse),
        (status = 500, body = model::response::GenericErrorResponse),
    )
)]
#[tracing::instrument(
    skip(state, user, access, project),
    fields(user_id = ?user.authorization.user.macro_user_id),
    err
)]
pub async fn delete_project_handler<T, Svc, Auth>(
    State(state): State<ProjectRouterState<T, Svc, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    access: ProjectAccessLevelExtractor<OwnerAccessLevel, Svc, Auth>,
    project: Extension<BasicProject>,
) -> Result<Json<ProjectDeleteResponse>, ProjectError>
where
    T: ProjectService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let deleted = state
        .service
        .soft_delete_project(
            access.entity_access_receipt,
            project.0,
            user.authorization.user.macro_user_id.to_string(),
        )
        .await?;

    Ok(Json(ProjectDeleteResponse {
        error: false,
        data: ProjectDeleteResponseData {
            project_ids: deleted.project_ids,
            document_ids: deleted.document_ids,
            chat_ids: deleted.chat_ids,
        },
    }))
}

/// Permanently delete a soft-deleted project and all of its children.
#[utoipa::path(
    tag = "project",
    delete,
    operation_id = "permanently_delete_project",
    path = "/projects/{id}/permanent",
    params(("id" = String, Path, description = "ID of the project")),
    responses(
        (status = 200, body = SuccessResponse),
        (status = 401, body = model::response::GenericErrorResponse),
        (status = 404, body = model::response::GenericErrorResponse),
        (status = 500, body = model::response::GenericErrorResponse),
    )
)]
#[tracing::instrument(
    skip(state, user, access, project),
    fields(user_id = ?user.authorization.user.macro_user_id),
    err
)]
pub async fn permanently_delete_project_handler<T, Svc, Auth>(
    State(state): State<ProjectRouterState<T, Svc, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    access: ProjectAccessLevelExtractor<OwnerAccessLevel, Svc, Auth>,
    Extension(project): Extension<BasicProject>,
) -> Result<Json<SuccessResponse>, ProjectError>
where
    T: ProjectService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    state
        .service
        .permanently_delete_project(access.entity_access_receipt, project)
        .await?;

    Ok(Json(SuccessResponse {
        error: false,
        data: GenericSuccessResponse { success: true },
    }))
}
