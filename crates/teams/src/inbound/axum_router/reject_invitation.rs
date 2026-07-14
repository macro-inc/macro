use axum::extract::{Path, State};
use entity_access::domain::ports::EntityAccessService;
use model_error_response::ErrorResponse;
use model_user::axum_extractor::MacroUserExtractor;

use crate::domain::{model::RemoveTeamInviteError, team_repo::TeamService};

use super::TeamRouterState;

/// Path parameters for reject invitation endpoint.
#[derive(serde::Deserialize)]
pub struct TeamInvitePathParam {
    /// The team invite ID.
    pub team_invite_id: uuid::Uuid,
}

/// Rejects an invitation to join a team.
#[utoipa::path(
    delete,
    path = "/team/join/{team_invite_id}",
    operation_id = "reject_invitation",
    params(
        ("team_invite_id" = String, Path, description = "The team invite id")
    ),
    responses(
        (status = 200),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err)]
pub async fn handler<T: TeamService, Eas: EntityAccessService>(
    State(state): State<TeamRouterState<T, Eas>>,
    user_context: MacroUserExtractor,
    Path(TeamInvitePathParam { team_invite_id }): Path<TeamInvitePathParam>,
) -> Result<(), RemoveTeamInviteError> {
    state
        .service
        .reject_invitation(&user_context.macro_user_id, &team_invite_id)
        .await?;
    Ok(())
}
