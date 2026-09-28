//! Handler for unassigning one task from an initiative.

use axum::{
    Json,
    extract::{Path, State},
};
use entity_access::domain::models::{EditAccessLevel, EntityType};
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::InitiativeAccessExtractor;
use macro_authorization::{MacroAuthorizationExtractor, MacroAuthorizationService, UserOrInternal};
use model_error_response::ErrorResponse;

use super::{GenericSuccessResponse, InitiativeRouterState, UnassignTaskParams};
use crate::domain::{models::InitiativeError, ports::InitiativeService};

/// Unassign one task the caller can edit.
#[utoipa::path(
    delete,
    tag = "initiative",
    operation_id = "unassign_initiative_task",
    path = "/initiatives/{initiative_id}/tasks/{task_id}",
    params(UnassignTaskParams),
    responses(
        (status = 200, body = GenericSuccessResponse),
        (status = 400, body = ErrorResponse),
        (status = 401, description = "Missing or invalid credentials", body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn unassign_initiative_task_handler<S, Eas, Auth>(
    State(state): State<InitiativeRouterState<S, Eas, Auth>>,
    access: InitiativeAccessExtractor<EditAccessLevel, Eas, Auth>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(UnassignTaskParams { task_id, .. }): Path<UnassignTaskParams>,
) -> Result<Json<GenericSuccessResponse>, InitiativeError>
where
    S: InitiativeService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let task_receipt = state
        .entity_access_service
        .generate_entity_access_receipt::<EditAccessLevel>(
            &user.authorization.user.macro_user_id,
            user.authorization
                .user
                .user_context
                .organization_id
                .map(i64::from),
            &task_id,
            EntityType::Document,
        )
        .await?;
    state
        .service
        .unassign_task(access.entity_access_receipt, task_receipt)
        .await?;
    Ok(Json(GenericSuccessResponse { success: true }))
}
