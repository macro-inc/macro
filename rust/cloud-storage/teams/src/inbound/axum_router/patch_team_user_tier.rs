use axum::{Json, extract::State};
use entity_access::{
    domain::{models::OwnerTeamRole, ports::EntityAccessService},
    inbound::axum_extractors::MacroUserTeamExtractor,
};
use model_error_response::ErrorResponse;

use crate::domain::{
    model::{PatchTeamUserTierRequest, TeamError},
    team_repo::TeamService,
};

use super::TeamRouterState;

/// Updates a team.
#[utoipa::path(
    patch,
    path = "/team/tier",
    operation_id = "patch_team_user_tier",
    request_body = PatchTeamUserTierRequest,
    responses(
        (status = 200),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err)]
pub async fn handler<T: TeamService, Eas: EntityAccessService>(
    access: MacroUserTeamExtractor<OwnerTeamRole, Eas>,
    State(state): State<TeamRouterState<T, Eas>>,
    Json(req): Json<PatchTeamUserTierRequest>,
) -> Result<(), TeamError> {
    state
        .service
        .patch_team_user_tier(access.entity_access_receipt, &req)
        .await?;
    Ok(())
}
