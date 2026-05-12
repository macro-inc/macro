use axum::extract::{Path, State};
use entity_access::{
    domain::{models::OwnerTeamRole, ports::EntityAccessService},
    inbound::axum_extractors::MacroUserTeamExtractor,
};
use model_error_response::ErrorResponse;

use crate::domain::{model::RemoveTeamInviteError, team_repo::TeamService};

use super::TeamRouterState;

/// Path parameters for delete team invite endpoint.
#[derive(serde::Deserialize)]
pub struct Param {
    /// The team invite ID.
    pub team_invite_id: uuid::Uuid,
}

/// Deletes a team invite from a team.
#[utoipa::path(
    delete,
    path = "/team/invite/{team_invite_id}",
    operation_id = "delete_team_invite_handler",
    params(
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
pub async fn handler<T: TeamService, Eas: EntityAccessService>(
    access: MacroUserTeamExtractor<OwnerTeamRole, Eas>,
    State(state): State<TeamRouterState<T, Eas>>,
    Path(Param { team_invite_id }): Path<Param>,
) -> Result<(), RemoveTeamInviteError> {
    state
        .service
        .delete_team_invite(access.entity_access_receipt, &team_invite_id)
        .await?;
    Ok(())
}
