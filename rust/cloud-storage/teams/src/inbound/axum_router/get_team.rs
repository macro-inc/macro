use axum::{
    Json,
    extract::{Path, State},
};
use model_error_response::ErrorResponse;

use crate::domain::{
    model::{TeamError, TeamWithMembers},
    team_repo::TeamService,
};

use super::{TeamPathParam, TeamRouterState, middleware::TeamAccessRoleExtractor};

/// Gets a team by ID.
#[utoipa::path(
    get,
    path = "/team/{team_id}",
    operation_id = "get_team",
    params(
        ("team_id" = String, Path, description = "The ID of the team to retrieve")
    ),
    responses(
        (status = 200, body = TeamWithMembers),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err)]
pub async fn handler<T: TeamService>(
    _access: TeamAccessRoleExtractor<super::middleware::MemberRole, T>,
    State(state): State<TeamRouterState<T>>,
    Path(TeamPathParam { team_id }): Path<TeamPathParam>,
) -> Result<Json<TeamWithMembers>, TeamError> {
    let team = state.service.get_team(&team_id).await?;
    Ok(Json(team))
}
