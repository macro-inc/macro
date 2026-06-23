use axum::{
    Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use entity_access::{
    domain::{models::MemberTeamRole, ports::EntityAccessService},
    inbound::axum_extractors::OptionalMacroUserTeamExtractor,
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
        (status = 204),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err)]
pub async fn handler<T: TeamService, Eas: EntityAccessService>(
    access: OptionalMacroUserTeamExtractor<MemberTeamRole, Eas>,
    State(state): State<TeamRouterState<T, Eas>>,
) -> Result<Response, TeamError> {
    let Some(receipt) = access.entity_access_receipt else {
        return Ok(StatusCode::NO_CONTENT.into_response());
    };
    let team = state.service.get_team(receipt).await?;
    Ok(Json(team).into_response())
}
