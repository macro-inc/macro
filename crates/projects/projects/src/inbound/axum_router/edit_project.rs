//! Handler for editing projects.

use axum::{Extension, Json, extract::State};
use entity_access::{
    domain::{models::EditAccessLevel, ports::EntityAccessService},
    inbound::axum_extractors::{ProjectAccessLevelExtractor, ProjectBodyAccessLevelExtractorV2},
};
use macro_authorization::{MacroAuthorizationExtractor, MacroAuthorizationService, UserOrInternal};
use model::{
    project::{BasicProject, request::PatchProjectRequestV2},
    response::{GenericSuccessResponse, SuccessResponse},
};

use super::ProjectRouterState;
use crate::domain::{models::ProjectError, ports::ProjectService};

/// Edit project metadata and sharing settings.
#[utoipa::path(
    tag = "project",
    patch,
    operation_id = "edit_project_v2",
    path = "/v2/projects/{id}",
    params(("id" = String, Path, description = "ID of the project")),
    request_body = PatchProjectRequestV2,
    responses(
        (status = 200, body = SuccessResponse),
        (status = 401, body = model::response::GenericErrorResponse),
        (status = 500, body = model::response::GenericErrorResponse),
    )
)]
#[tracing::instrument(
    skip(state, user, access, project, body),
    fields(user_id = ?user.authorization.user.macro_user_id),
    err
)]
pub async fn edit_project_handler<T, Svc, Auth>(
    State(state): State<ProjectRouterState<T, Svc, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    access: ProjectAccessLevelExtractor<EditAccessLevel, Svc, Auth>,
    project: Extension<BasicProject>,
    body: ProjectBodyAccessLevelExtractorV2<EditAccessLevel, PatchProjectRequestV2, Svc, Auth>,
) -> Result<Json<SuccessResponse>, ProjectError>
where
    T: ProjectService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let body = body.into_inner();
    // A scoped session shares nothing; this route's path can't say whether
    // its body does.
    agent_correlation::context::refuse_sharing(body.share_permission.is_some())
        .map_err(|refused| ProjectError::Forbidden(refused.to_string()))?;
    state
        .service
        .edit_project(access.entity_access_receipt, project.0, body)
        .await?;

    Ok(Json(SuccessResponse {
        error: false,
        data: GenericSuccessResponse::default(),
    }))
}
