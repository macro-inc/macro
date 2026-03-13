//! Handler for `POST /documents/create_task`.

use axum::{Json, extract::State};
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::ProjectBodyAccessLevelExtractor;
use model_user::axum_extractor::MacroUserExtractor;
use models_permissions::share_permission::access_level::EditAccessLevel;

use super::DocumentRouterState;
use crate::domain::models::{CreateTaskRequest, CreateTaskResponse, DocumentError};
use crate::domain::ports::DocumentService;

/// Creates a task document with properties in a single call.
///
/// This endpoint creates task metadata and sets properties atomically.
/// Task content should be set separately via the sync service.
#[utoipa::path(
    tag = "document",
    post,
    path = "/documents/create_task",
    request_body = CreateTaskRequest,
    responses(
        (status = 200, body = inline(CreateTaskResponse)),
        (status = 400, body = model_error_response::ErrorResponse),
        (status = 401, body = model_error_response::ErrorResponse),
        (status = 500, body = model_error_response::ErrorResponse),
    )
)]
#[tracing::instrument(skip(state, user_context, project), fields(user_id=?user_context.macro_user_id))]
pub async fn create_task_handler<T: DocumentService, Svc: EntityAccessService>(
    State(state): State<DocumentRouterState<T, Svc>>,
    user_context: MacroUserExtractor,
    project: ProjectBodyAccessLevelExtractor<EditAccessLevel, CreateTaskRequest, Svc>,
) -> Result<Json<CreateTaskResponse>, DocumentError> {
    let req = project.into_inner();
    let user_id = user_context.user_context.user_id.clone();
    let macro_user_id = user_context.macro_user_id;

    let response = state
        .service
        .create_task(macro_user_id, user_id, req)
        .await?;

    Ok(Json(response))
}
