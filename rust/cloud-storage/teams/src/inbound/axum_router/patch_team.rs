use axum::{
    Json,
    extract::{Path, State},
};
use model_error_response::ErrorResponse;

use crate::domain::{
    model::{PatchTeamRequest, TeamError},
    team_repo::TeamService,
};

use super::{TeamPathParam, TeamRouterState, middleware::TeamAccessRoleExtractor};

/// Updates a team.
#[utoipa::path(
    patch,
    path = "/team/{team_id}",
    operation_id = "patch_team",
    params(
        ("team_id" = String, Path, description = "The ID of the team to update")
    ),
    request_body = PatchTeamRequest,
    responses(
        (status = 200),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err)]
pub async fn handler<T: TeamService>(
    _access: TeamAccessRoleExtractor<super::middleware::AdminRole, T>,
    State(state): State<TeamRouterState<T>>,
    Path(TeamPathParam { team_id }): Path<TeamPathParam>,
    Json(req): Json<PatchTeamRequest>,
) -> Result<(), TeamError> {
    state.service.patch_team(&team_id, &req).await?;
    Ok(())
}
