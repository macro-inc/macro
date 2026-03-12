use axum::extract::{Path, State};
use model_error_response::ErrorResponse;
use model_user::axum_extractor::MacroUserExtractor;

use crate::domain::{model::RemoveUserFromTeamError, team_repo::TeamService};

use super::{TeamRouterState, middleware::TeamAccessRoleExtractor};

/// Path parameters for remove user endpoint.
#[derive(serde::Deserialize)]
pub struct Param {
    /// The team ID.
    pub team_id: uuid::Uuid,
    /// The ID of the user to remove.
    pub remove_user_id: String,
}

/// Removes a user from a team.
#[utoipa::path(
    delete,
    path = "/team/{team_id}/remove/{remove_user_id}",
    operation_id = "remove_user_from_team",
    params(
        ("team_id" = String, Path, description = "The ID of the team"),
        ("remove_user_id" = String, Path, description = "The ID of the user to remove")
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
    user_context: MacroUserExtractor,
    Path(Param {
        team_id,
        remove_user_id: _,
    }): Path<Param>,
) -> Result<(), RemoveUserFromTeamError> {
    state
        .service
        .remove_user_from_team(&team_id, &user_context.macro_user_id)
        .await?;
    Ok(())
}
