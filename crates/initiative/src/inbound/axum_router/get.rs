//! Handler for fetching one initiative.

use axum::{Json, extract::State};
use entity_access::domain::models::ViewAccessLevel;
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::InitiativeAccessExtractor;
use macro_authorization::MacroAuthorizationService;
use model_error_response::ErrorResponse;

use super::{InitiativeIdParams, InitiativeRouterState};
use crate::domain::{
    models::{InitiativeDetail, InitiativeError},
    ports::InitiativeService,
};

/// Fetch one initiative the caller can view.
#[utoipa::path(
    get,
    tag = "initiative",
    operation_id = "get_initiative",
    path = "/initiatives/{initiative_id}",
    params(InitiativeIdParams),
    responses(
        (status = 200, body = InitiativeDetail),
        (status = 400, body = ErrorResponse),
        (status = 401, description = "Missing or invalid credentials", body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn get_initiative_handler<S, Eas, Auth>(
    State(state): State<InitiativeRouterState<S, Eas, Auth>>,
    access: InitiativeAccessExtractor<ViewAccessLevel, Eas, Auth>,
) -> Result<Json<InitiativeDetail>, InitiativeError>
where
    S: InitiativeService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let detail = state.service.get(access.entity_access_receipt).await?;
    Ok(Json(detail))
}
