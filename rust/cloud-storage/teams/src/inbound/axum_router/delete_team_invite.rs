use axum::extract::{Path, State};
use model_error_response::ErrorResponse;

use crate::domain::{model::RemoveTeamInviteError, team_repo::TeamService};

use super::{TeamRouterState, middleware::TeamAccessRoleExtractor};

/// Path parameters for delete team invite endpoint.
#[derive(serde::Deserialize)]
pub struct Param {
    /// The team ID.
    pub team_id: uuid::Uuid,
    /// The team invite ID.
    pub team_invite_id: uuid::Uuid,
}

/// Deletes a team invite from a team.
#[utoipa::path(
    delete,
    path = "/team/{team_id}/invite/{team_invite_id}",
    operation_id = "delete_team_invite_handler",
    params(
        ("team_id" = String, Path, description = "The ID of the team"),
        ("team_invite_id" = String, Path, description = "The ID of the team invite")
    ),
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
    _access: TeamAccessRoleExtractor<super::middleware::OwnerRole, T>,
    State(state): State<TeamRouterState<T>>,
    Path(Param {
        team_id,
        team_invite_id,
    }): Path<Param>,
) -> Result<(), RemoveTeamInviteError> {
    state
        .service
        .delete_team_invite(&team_id, &team_invite_id)
        .await?;
    Ok(())
}
