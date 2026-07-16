//! Handler for batch project previews.

use axum::{Json, extract::State};
use entity_access::domain::ports::EntityAccessService;
use macro_authorization::{MacroAuthorizationService, OptionalMacroAuthorizationExtractor};
use model::project::{
    request::GetBatchProjectPreviewRequest, response::GetBatchProjectPreviewResponse,
};

use super::ProjectRouterState;
use crate::domain::{models::ProjectError, ports::ProjectService};

/// Get previews for a batch of project IDs.
#[utoipa::path(
    tag = "project",
    post,
    path = "/projects/preview",
    operation_id = "get_batch_project_preview",
    responses(
        (status = 200, body = GetBatchProjectPreviewResponse),
        (status = 401, body = model::response::GenericErrorResponse),
        (status = 500, body = model::response::GenericErrorResponse),
    )
)]
#[tracing::instrument(skip(state, user, request), fields(user_id=?user.macro_user_id), err)]
pub async fn get_batch_preview_handler<T, Svc, Auth>(
    State(state): State<ProjectRouterState<T, Svc, Auth>>,
    user: OptionalMacroAuthorizationExtractor<Auth>,
    Json(request): Json<GetBatchProjectPreviewRequest>,
) -> Result<Json<GetBatchProjectPreviewResponse>, ProjectError>
where
    T: ProjectService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let previews = state
        .service
        .get_batch_preview(user.macro_user_id, request.project_ids)
        .await?;
    Ok(Json(GetBatchProjectPreviewResponse { previews }))
}
