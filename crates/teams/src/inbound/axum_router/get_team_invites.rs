use axum::{Json, extract::State};
use entity_access::{
    domain::{models::AdminTeamRole, ports::EntityAccessService},
    inbound::axum_extractors::MacroUserTeamExtractorV2,
};
use macro_authorization::MacroAuthorizationService;
use model_error_response::ErrorResponse;

use crate::domain::{
    model::{TeamError, TeamInviteDetails},
    team_repo::TeamService,
};

use super::TeamRouterState;

/// Response containing a list of team invites
#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct TeamInvitesResponse {
    /// The invites
    pub invites: Vec<TeamInviteDetails>,
}

/// Gets all invites for a team.
#[utoipa::path(
    get,
    path = "/team/invites",
    operation_id = "get_team_invites",
    responses(
        (status = 200, body = TeamInvitesResponse),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err)]
pub async fn handler<T: TeamService, Eas: EntityAccessService, Auth: MacroAuthorizationService>(
    access: MacroUserTeamExtractorV2<AdminTeamRole, Eas, Auth>,
    State(state): State<TeamRouterState<T, Eas, Auth>>,
) -> Result<Json<TeamInvitesResponse>, TeamError> {
    let invites = state
        .service
        .get_team_invites(access.entity_access_receipt)
        .await?;
    Ok(Json(TeamInvitesResponse { invites }))
}
