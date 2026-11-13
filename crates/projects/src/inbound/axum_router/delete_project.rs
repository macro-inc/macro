//! Handler for soft-deleting projects.

use std::sync::Arc;

use axum::{Extension, Json, extract::State};
use entity_access::{
    domain::{models::OwnerAccessLevel, ports::EntityAccessService},
    inbound::axum_extractors::ProjectAccessLevelExtractor,
};
use macro_authorization::{MacroAuthorizationExtractor, MacroAuthorizationService, UserOrInternal};
use model::project::BasicProject;
use model::response::{GenericSuccessResponse, SuccessResponse, TypedSuccessResponse};
use serde::{Deserialize, Serialize};
use tracing::Instrument;
use utoipa::ToSchema;

use super::ProjectRouterState;
use crate::domain::{models::ProjectError, ports::ProjectService};

/// Run a folder tree operation on its own task and wait for it. Trash,
/// restore and purge write every item in the tree, so a dropped request must
/// not cancel them partway: the task carries on to completion, including a
/// purge's document cleanup after its commit. The task keeps the request's
/// agent attribution, which the operation's events carry.
pub(super) async fn run_on_own_task<R, F>(work: F) -> Result<R, ProjectError>
where
    R: Send + 'static,
    F: Future<Output = Result<R, ProjectError>> + Send + 'static,
{
    tokio::spawn(agent_correlation::context::capture(work.in_current_span()))
        .await
        .map_err(|error| ProjectError::Internal(anyhow::anyhow!(error)))?
}

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
    let service = Arc::clone(&state.service);
    let receipt = access.entity_access_receipt;
    let actor_user_id = user.authorization.user.macro_user_id.to_string();
    let deleted = run_on_own_task(async move {
        service
            .soft_delete_project(receipt, project.0, actor_user_id)
            .await
    })
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
    let service = Arc::clone(&state.service);
    let receipt = access.entity_access_receipt;
    run_on_own_task(async move { service.permanently_delete_project(receipt, project).await })
        .await?;

    Ok(Json(SuccessResponse {
        error: false,
        data: GenericSuccessResponse { success: true },
    }))
}
