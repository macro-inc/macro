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
#[tracing::instrument(
    skip(state, user, request),
    fields(user_id = tracing::field::Empty),
    err
)]
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
    let user_id = user
        .authorization
        .as_ref()
        .and_then(|authorization| authorization.acting_user())
        .map(|user| user.macro_user_id.clone());
    if let Some(user_id) = &user_id {
        tracing::Span::current().record("user_id", tracing::field::display(user_id));
    }
    let previews = state
        .service
        .get_batch_preview(user_id, request.project_ids)
        .await?;
    Ok(Json(GetBatchProjectPreviewResponse { previews }))
}
