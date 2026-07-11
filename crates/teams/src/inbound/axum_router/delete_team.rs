use axum::extract::State;
use entity_access::{
    domain::{models::OwnerTeamRole, ports::EntityAccessService},
    inbound::axum_extractors::MacroUserTeamExtractor,
};
use model_error_response::ErrorResponse;

use crate::domain::{model::DeleteTeamError, team_repo::TeamService};

use super::TeamRouterState;

/// Deletes a team.
/// This will update all team members roles and cancel your subscription for the team.
/// This action is **irreversible** and you will not be able to recover the team afterwards.
#[utoipa::path(
    delete,
    path = "/team",
    operation_id = "delete_team",
    responses(
        (status = 200),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err)]
pub async fn handler<T: TeamService, Eas: EntityAccessService>(
    access: MacroUserTeamExtractor<OwnerTeamRole, Eas>,
    State(state): State<TeamRouterState<T, Eas>>,
) -> Result<(), DeleteTeamError> {
    state
        .service
        .delete_team(access.entity_access_receipt)
        .await?;
    Ok(())
}
