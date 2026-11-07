//! Handler for deleting an initiative.

use axum::{Json, extract::State};
use entity_access::domain::models::OwnerAccessLevel;
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::InitiativeAccessExtractor;
use macro_authorization::MacroAuthorizationService;
use model_error_response::ErrorResponse;

use super::{GenericSuccessResponse, InitiativeIdParams, InitiativeRouterState};
use crate::domain::{models::InitiativeError, ports::InitiativeService};

/// Delete the initiative the caller owns.
#[utoipa::path(
    delete,
    tag = "initiative",
    operation_id = "delete_initiative",
    path = "/initiatives/{initiative_id}",
    params(InitiativeIdParams),
    responses(
        (status = 200, body = GenericSuccessResponse),
        (status = 400, body = ErrorResponse),
        (status = 401, description = "Missing or invalid credentials", body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn delete_initiative_handler<S, Eas, Auth>(
    State(state): State<InitiativeRouterState<S, Eas, Auth>>,
    access: InitiativeAccessExtractor<OwnerAccessLevel, Eas, Auth>,
) -> Result<Json<GenericSuccessResponse>, InitiativeError>
where
    S: InitiativeService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    state.service.delete(access.entity_access_receipt).await?;
    Ok(Json(GenericSuccessResponse { success: true }))
}
