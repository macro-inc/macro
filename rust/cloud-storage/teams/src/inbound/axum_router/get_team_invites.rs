use axum::{
    Json,
    extract::{Path, State},
};
use model_error_response::ErrorResponse;

use crate::domain::{
    model::{TeamError, TeamInviteDetails},
    team_repo::TeamService,
};

use super::{TeamPathParam, TeamRouterState, middleware::TeamAccessRoleExtractor};

/// Response containing a list of team invites
#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct TeamInvitesResponse {
    /// The invites
    pub invites: Vec<TeamInviteDetails>,
}

/// Gets all invites for a team.
#[utoipa::path(
    get,
    path = "/team/{team_id}/invites",
    operation_id = "get_team_invites",
    params(
        ("team_id" = String, Path, description = "The ID of the team to get invites for")
    ),
    responses(
        (status = 200, body = TeamInvitesResponse),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err)]
pub async fn handler<T: TeamService>(
    _access: TeamAccessRoleExtractor<super::middleware::AdminRole, T>,
    State(state): State<TeamRouterState<T>>,
    Path(TeamPathParam { team_id }): Path<TeamPathParam>,
) -> Result<Json<TeamInvitesResponse>, TeamError> {
    let invites = state.service.get_team_invites(&team_id).await?;
    Ok(Json(TeamInvitesResponse { invites }))
}
