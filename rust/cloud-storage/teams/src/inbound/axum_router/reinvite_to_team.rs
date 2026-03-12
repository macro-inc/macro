use axum::extract::{Path, State};
use model_error_response::ErrorResponse;
use model_user::axum_extractor::MacroUserExtractor;

use crate::domain::{model::ReinviteError, team_repo::TeamService};

use super::{TeamRouterState, middleware::TeamAccessRoleExtractor};

/// Path parameters for reinvite endpoint.
#[derive(serde::Deserialize)]
pub struct Param {
    /// The team ID.
    pub team_id: uuid::Uuid,
    /// The team invite ID.
    pub team_invite_id: uuid::Uuid,
}

/// Regenerates a team invite notifying the user again.
#[utoipa::path(
    post,
    path = "/team/{team_id}/reinvite/{team_invite_id}",
    operation_id = "reinvite_to_team",
    params(
        ("team_id" = String, Path, description = "The ID of the team to invite to"),
        ("team_invite_id" = String, Path, description = "The ID of the team invite to reinvite")
    ),
    responses(
        (status = 200),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 429, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err)]
pub async fn handler<T: TeamService>(
    _access: TeamAccessRoleExtractor<super::middleware::AdminRole, T>,
    State(state): State<TeamRouterState<T>>,
    user_context: MacroUserExtractor,
    Path(Param {
        team_id: _,
        team_invite_id,
    }): Path<Param>,
) -> Result<(), ReinviteError> {
    state
        .service
        .reinvite_to_team(&team_invite_id, &user_context.macro_user_id)
        .await?;
    Ok(())
}
