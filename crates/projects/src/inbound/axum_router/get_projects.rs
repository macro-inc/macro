//! Handlers for listing projects.

use axum::{Json, extract::State};
use entity_access::domain::ports::EntityAccessService;
use macro_authorization::{MacroAuthorizationExtractor, MacroAuthorizationService};
use model::{project::response::GetProjectsResponse, response::TypedSuccessResponse};

use super::ProjectRouterState;
use crate::domain::{models::ProjectError, ports::ProjectService};

/// Successful pending-project list response.
pub type PendingProjectsResponse = TypedSuccessResponse<Vec<model::project::PendingProject>>;

/// List projects visible to the authenticated user.
#[utoipa::path(
    tag = "project",
    get,
    path = "/projects",
    responses(
        (status = 200, body = GetProjectsResponse),
        (status = 401, body = model::response::GenericErrorResponse),
        (status = 500, body = model::response::GenericErrorResponse),
    )
)]
#[tracing::instrument(skip(state, user), fields(user_id=?user.macro_user_id), err)]
pub async fn get_projects_handler<T, Svc, Auth>(
    State(state): State<ProjectRouterState<T, Svc, Auth>>,
    user: MacroAuthorizationExtractor<Auth>,
) -> Result<Json<GetProjectsResponse>, ProjectError>
where
    T: ProjectService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let projects = state.service.list_projects(user.macro_user_id).await?;
    Ok(Json(GetProjectsResponse {
        error: false,
        data: projects,
    }))
}

/// List pending root projects owned by the authenticated user.
#[utoipa::path(
    tag = "project",
    get,
    path = "/projects/pending",
    responses(
        (status = 200, body = inline(PendingProjectsResponse)),
        (status = 401, body = model::response::GenericErrorResponse),
        (status = 500, body = model::response::GenericErrorResponse),
    )
)]
#[tracing::instrument(skip(state, user), fields(user_id=?user.macro_user_id), err)]
pub async fn get_pending_projects_handler<T, Svc, Auth>(
    State(state): State<ProjectRouterState<T, Svc, Auth>>,
    user: MacroAuthorizationExtractor<Auth>,
) -> Result<Json<PendingProjectsResponse>, ProjectError>
where
    T: ProjectService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let projects = state
        .service
        .list_pending_projects(user.macro_user_id)
        .await?;
    Ok(Json(PendingProjectsResponse {
        error: false,
        data: projects,
    }))
}
