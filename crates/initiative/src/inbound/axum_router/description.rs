//! Handler for reading an initiative's description.

use axum::{Json, extract::State};
use entity_access::domain::models::ViewAccessLevel;
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::InitiativeAccessExtractor;
use macro_authorization::MacroAuthorizationService;
use model_error_response::ErrorResponse;
use serde::Serialize;

use super::{InitiativeIdParams, InitiativeRouterState};
use crate::domain::{models::InitiativeError, ports::InitiativeService};

/// An initiative's description.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct InitiativeDescription {
    /// GitHub-flavored markdown; empty while no one has opened or written it.
    pub markdown: String,
}

/// Read the description of an initiative the caller can view.
#[utoipa::path(
    get,
    tag = "initiative",
    operation_id = "get_initiative_description",
    path = "/initiatives/{initiative_id}/description",
    params(InitiativeIdParams),
    responses(
        (status = 200, body = InitiativeDescription),
        (status = 400, body = ErrorResponse),
        (status = 401, description = "Missing or invalid credentials", body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn get_initiative_description_handler<S, Eas, Auth>(
    State(state): State<InitiativeRouterState<S, Eas, Auth>>,
    access: InitiativeAccessExtractor<ViewAccessLevel, Eas, Auth>,
) -> Result<Json<InitiativeDescription>, InitiativeError>
where
    S: InitiativeService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let markdown = state
        .service
        .read_description(access.entity_access_receipt)
        .await?;
    Ok(Json(InitiativeDescription { markdown }))
}
