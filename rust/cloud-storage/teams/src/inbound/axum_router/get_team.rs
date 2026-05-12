use axum::{Json, extract::State};
use entity_access::{
    domain::{models::MemberTeamRole, ports::EntityAccessService},
    inbound::axum_extractors::MacroUserTeamExtractor,
};
use model_error_response::ErrorResponse;

use crate::domain::{
    model::{TeamError, TeamWithMembers},
    team_repo::TeamService,
};

use super::TeamRouterState;

/// Gets a team by ID.
#[utoipa::path(
    get,
    path = "/team",
    operation_id = "get_team",
    responses(
        (status = 200, body = TeamWithMembers),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err)]
pub async fn handler<T: TeamService, Eas: EntityAccessService>(
    access: MacroUserTeamExtractor<MemberTeamRole, Eas>,
    State(state): State<TeamRouterState<T, Eas>>,
) -> Result<Json<TeamWithMembers>, TeamError> {
    let team = state.service.get_team(access.entity_access_receipt).await?;
    Ok(Json(team))
}
