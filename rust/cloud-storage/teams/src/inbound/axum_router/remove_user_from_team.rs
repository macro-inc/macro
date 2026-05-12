use axum::extract::{Path, State};
use entity_access::{
    domain::{models::OwnerTeamRole, ports::EntityAccessService},
    inbound::axum_extractors::MacroUserTeamExtractor,
};
use macro_user_id::user_id::MacroUserIdStr;
use model_error_response::ErrorResponse;

use crate::domain::{model::RemoveUserFromTeamError, team_repo::TeamService};

use super::TeamRouterState;

/// Path parameters for remove user endpoint.
#[derive(serde::Deserialize)]
pub struct Param {
    /// The ID of the user to remove.
    pub remove_user_id: MacroUserIdStr<'static>,
}

/// Removes a user from a team.
#[utoipa::path(
    delete,
    path = "/team/remove/{remove_user_id}",
    operation_id = "remove_user_from_team",
    params(
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
pub async fn handler<T: TeamService, Eas: EntityAccessService>(
    access: MacroUserTeamExtractor<OwnerTeamRole, Eas>,
    State(state): State<TeamRouterState<T, Eas>>,
    Path(Param { remove_user_id }): Path<Param>,
) -> Result<(), RemoveUserFromTeamError> {
    state
        .service
        .remove_user_from_team(access.entity_access_receipt, &remove_user_id)
        .await?;
    Ok(())
}
