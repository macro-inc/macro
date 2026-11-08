//! Handler for updating an initiative.

use axum::{Json, extract::State};
use entity_access::domain::models::EditAccessLevel;
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::InitiativeAccessExtractor;
use macro_authorization::MacroAuthorizationService;
use model_error_response::ErrorResponse;

use super::{InitiativeIdParams, InitiativeRouterState};
use crate::domain::{
    models::{InitiativeDetail, InitiativeError, UpdateInitiativeRequest},
    ports::InitiativeService,
};

/// Update fields the caller can edit.
#[utoipa::path(
    patch,
    tag = "initiative",
    operation_id = "update_initiative",
    path = "/initiatives/{initiative_id}",
    params(InitiativeIdParams),
    request_body = UpdateInitiativeRequest,
    responses(
        (status = 200, body = InitiativeDetail),
        (status = 400, body = ErrorResponse),
        (status = 401, description = "Missing or invalid credentials", body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 409, body = ErrorResponse),
        (status = 422, description = "Name exceeds the maximum length", body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn update_initiative_handler<S, Eas, Auth>(
    State(state): State<InitiativeRouterState<S, Eas, Auth>>,
    access: InitiativeAccessExtractor<EditAccessLevel, Eas, Auth>,
    Json(request): Json<UpdateInitiativeRequest>,
) -> Result<Json<InitiativeDetail>, InitiativeError>
where
    S: InitiativeService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let detail = state
        .service
        .update(access.entity_access_receipt, request)
        .await?;
    Ok(Json(detail))
}
