//! Handler for restoring soft-deleted projects.

use std::sync::Arc;

use axum::{Extension, Json, extract::State};
use entity_access::{
    domain::{models::OwnerAccessLevel, ports::EntityAccessService},
    inbound::axum_extractors::ProjectAccessLevelExtractor,
};
use macro_authorization::MacroAuthorizationService;
use model::{
    project::BasicProject,
    response::{GenericSuccessResponse, SuccessResponse},
};

use super::{ProjectRouterState, delete_project::run_on_own_task};
use crate::domain::{models::ProjectError, ports::ProjectService};

/// Restore a soft-deleted project and its children.
#[utoipa::path(
    tag = "project",
    put,
    operation_id = "revert_delete_project",
    path = "/projects/{id}/revert_delete",
    params(("id" = String, Path, description = "ID of the project")),
    responses(
        (status = 200, body = SuccessResponse),
        (status = 401, body = model::response::GenericErrorResponse),
        (status = 404, body = model::response::GenericErrorResponse),
        (status = 500, body = model::response::GenericErrorResponse),
    )
)]
#[tracing::instrument(skip(state, access, project), err)]
pub async fn revert_delete_project_handler<T, Svc, Auth>(
    State(state): State<ProjectRouterState<T, Svc, Auth>>,
    access: ProjectAccessLevelExtractor<OwnerAccessLevel, Svc, Auth>,
    project: Extension<BasicProject>,
) -> Result<Json<SuccessResponse>, ProjectError>
where
    T: ProjectService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let service = Arc::clone(&state.service);
    let receipt = access.entity_access_receipt;
    run_on_own_task(async move { service.revert_delete_project(receipt, project.0).await }).await?;

    Ok(Json(SuccessResponse {
        error: false,
        data: GenericSuccessResponse::default(),
    }))
}
