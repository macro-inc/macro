//! Entity-owned project icon and color editing.

use axum::{Json, extract::State};
use entity_access::domain::{models::EditAccessLevel, ports::EntityAccessService};
use entity_access::inbound::axum_extractors::InitiativeAccessExtractor;
use macro_authorization::MacroAuthorizationService;
use model_entity::EntityAppearance;

use super::{InitiativeIdParams, InitiativeRouterState};
use crate::domain::{models::InitiativeError, ports::InitiativeService};

/// Replace a project's appearance without changing content timestamps.
#[utoipa::path(put, tag = "initiative", operation_id = "set_initiative_appearance",
    path = "/initiatives/{initiative_id}/appearance", params(InitiativeIdParams),
    request_body = EntityAppearance,
    responses((status = 200, body = EntityAppearance), (status = 400), (status = 401), (status = 404)))]
#[tracing::instrument(err, skip_all)]
pub async fn set_initiative_appearance<S, Eas, Auth>(
    State(state): State<InitiativeRouterState<S, Eas, Auth>>,
    access: InitiativeAccessExtractor<EditAccessLevel, Eas, Auth>,
    Json(appearance): Json<EntityAppearance>,
) -> Result<Json<EntityAppearance>, InitiativeError>
where
    S: InitiativeService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    Ok(Json(
        state
            .service
            .set_appearance(access.entity_access_receipt, appearance)
            .await?,
    ))
}
