use axum::extract::{Path, State};
use model_error_response::ErrorResponse;

use crate::domain::{model::DeleteTeamError, team_repo::TeamService};

use super::{TeamPathParam, TeamRouterState, middleware::TeamAccessRoleExtractor};

/// Deletes a team.
/// This will update all team members roles and cancel your subscription for the team.
/// This action is **irreversible** and you will not be able to recover the team afterwards.
#[utoipa::path(
    delete,
    path = "/team/{team_id}",
    operation_id = "delete_team",
    params(
        ("team_id" = String, Path, description = "The ID of the team to delete")
    ),
    responses(
        (status = 200),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err)]
pub async fn handler<T: TeamService>(
    _access: TeamAccessRoleExtractor<super::middleware::OwnerRole, T>,
    State(state): State<TeamRouterState<T>>,
    Path(TeamPathParam { team_id }): Path<TeamPathParam>,
) -> Result<(), DeleteTeamError> {
    state.service.delete_team(&team_id).await?;
    Ok(())
}
