//! Handlers for reading a project and its content.

use axum::{Json, extract::State};
use entity_access::{
    domain::{models::ViewAccessLevel, ports::EntityAccessService},
    inbound::axum_extractors::ProjectAccessLevelExtractor,
};
use macro_authorization::{MacroAuthorizationExtractor, MacroAuthorizationService, UserOrInternal};
use model::project::response::{GetProjectContentResponse, GetProjectResponse};

use super::ProjectRouterState;
use crate::domain::{models::ProjectError, ports::ProjectService};

/// Get project metadata.
#[utoipa::path(
    get,
    path = "/projects/{id}",
    params(("id" = String, Path, description = "ID of the project")),
    responses(
        (status = 200, body = GetProjectResponse),
        (status = 401, body = model::response::GenericErrorResponse),
        (status = 500, body = model::response::GenericErrorResponse),
    )
)]
#[tracing::instrument(
    skip(state, user, access),
    fields(user_id = ?user.authorization.user.macro_user_id),
    err
)]
pub async fn get_project_handler<T, Svc, Auth>(
    State(state): State<ProjectRouterState<T, Svc, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    access: ProjectAccessLevelExtractor<ViewAccessLevel, Svc, Auth>,
) -> Result<Json<GetProjectResponse>, ProjectError>
where
    T: ProjectService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let data = state
        .service
        .get_project(access.entity_access_receipt)
        .await?;
    Ok(Json(GetProjectResponse { error: false, data }))
}

/// Get a project's immediate children.
#[utoipa::path(
    tag = "project",
    get,
    path = "/projects/{id}/content",
    params(("id" = String, Path, description = "ID of the project")),
    responses(
        (status = 200, body = GetProjectContentResponse),
        (status = 401, body = model::response::GenericErrorResponse),
        (status = 500, body = model::response::GenericErrorResponse),
    )
)]
#[tracing::instrument(
    skip(state, user, access),
    fields(user_id = ?user.authorization.user.macro_user_id),
    err
)]
pub async fn get_project_content_handler<T, Svc, Auth>(
    State(state): State<ProjectRouterState<T, Svc, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    access: ProjectAccessLevelExtractor<ViewAccessLevel, Svc, Auth>,
) -> Result<Json<GetProjectContentResponse>, ProjectError>
where
    T: ProjectService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let data = state
        .service
        .get_project_content(access.entity_access_receipt)
        .await?;
    Ok(Json(GetProjectContentResponse { error: false, data }))
}
