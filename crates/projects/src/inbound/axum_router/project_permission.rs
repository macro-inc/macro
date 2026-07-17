//! Handlers for project permissions and caller access levels.

use axum::{Json, extract::State};
use entity_access::{
    domain::{
        models::{OwnerAccessLevel, ViewAccessLevel},
        ports::EntityAccessService,
    },
    inbound::axum_extractors::ProjectAccessLevelExtractor,
};
use macro_authorization::{MacroAuthorizationExtractor, MacroAuthorizationService};
use models_permissions::share_permission::{SharePermissionV2, access_level::AccessLevel};

use super::ProjectRouterState;
use crate::domain::{models::ProjectError, ports::ProjectService};

/// Get a project's share permissions.
#[utoipa::path(
    tag = "project",
    get,
    path = "/projects/{id}/permissions",
    operation_id = "get_project_permissions_v2",
    params(("id" = String, Path, description = "ID of the project")),
    responses(
        (status = 200, body = SharePermissionV2),
        (status = 404, body = model::response::GenericErrorResponse),
        (status = 500, body = model::response::GenericErrorResponse),
    )
)]
#[tracing::instrument(skip(state, user, access), fields(user_id=?user.macro_user_id), err)]
pub async fn get_project_permissions_handler<T, Svc, Auth>(
    State(state): State<ProjectRouterState<T, Svc, Auth>>,
    user: MacroAuthorizationExtractor<Auth>,
    access: ProjectAccessLevelExtractor<OwnerAccessLevel, Svc, Auth>,
) -> Result<Json<SharePermissionV2>, ProjectError>
where
    T: ProjectService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let permissions = state
        .service
        .get_project_permissions(access.entity_access_receipt)
        .await?;
    Ok(Json(permissions))
}

/// Get the caller's project access level.
#[utoipa::path(
    tag = "project",
    get,
    path = "/projects/{id}/access_level",
    operation_id = "get_project_user_access_level",
    params(("id" = String, Path, description = "ID of the project")),
    responses(
        (status = 200, body = AccessLevel),
        (status = 401, body = model::response::GenericErrorResponse),
        (status = 404, body = model::response::GenericErrorResponse),
        (status = 500, body = model::response::GenericErrorResponse),
    )
)]
#[tracing::instrument(skip(state, user, access), fields(user_id=?user.macro_user_id), err)]
pub async fn get_project_access_level_handler<T, Svc, Auth>(
    State(state): State<ProjectRouterState<T, Svc, Auth>>,
    user: MacroAuthorizationExtractor<Auth>,
    access: ProjectAccessLevelExtractor<ViewAccessLevel, Svc, Auth>,
) -> Result<Json<AccessLevel>, ProjectError>
where
    T: ProjectService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let access_level = state
        .service
        .get_project_access_level(access.entity_access_receipt)
        .await?;
    Ok(Json(access_level))
}
