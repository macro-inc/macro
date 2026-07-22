//! Handler for creating projects.

use axum::{Json, extract::State};
use entity_access::{
    domain::{models::EditAccessLevel, ports::EntityAccessService},
    inbound::axum_extractors::ProjectBodyAccessLevelExtractorV2,
};
use macro_authorization::{MacroAuthorizationExtractor, MacroAuthorizationService, UserOrInternal};
use model::project::{request::CreateProjectRequest, response::CreateProjectResponse};

use super::ProjectRouterState;
use crate::domain::{models::ProjectError, ports::ProjectService};

/// Create a project, optionally beneath an existing project.
#[utoipa::path(
    tag = "project",
    post,
    path = "/projects",
    request_body = CreateProjectRequest,
    responses(
        (status = 200, body = CreateProjectResponse),
        (status = 401, body = model::response::GenericErrorResponse),
        (status = 500, body = model::response::GenericErrorResponse),
    )
)]
#[tracing::instrument(
    skip(state, user, project),
    fields(user_id = ?user.authorization.user.macro_user_id),
    err
)]
pub async fn create_project_handler<T, Svc, Auth>(
    State(state): State<ProjectRouterState<T, Svc, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    project: ProjectBodyAccessLevelExtractorV2<EditAccessLevel, CreateProjectRequest, Svc, Auth>,
) -> Result<Json<CreateProjectResponse>, ProjectError>
where
    T: ProjectService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let data = state
        .service
        .create_project(
            user.authorization.user.macro_user_id.clone(),
            project.into_inner(),
        )
        .await?;

    Ok(Json(CreateProjectResponse { error: false, data }))
}
