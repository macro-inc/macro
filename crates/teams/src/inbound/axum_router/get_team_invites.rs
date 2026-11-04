use axum::{
    Json,
    extract::{Query, State},
    response::{IntoResponse, Response},
};
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

/// Query parameters for listing a team's invites
#[derive(Debug, serde::Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct GetTeamInvitesQuery {
    /// The team the caller means to list. Invites are always read from the
    /// caller's current team; when this names another team, the request
    /// answers 409.
    pub team_id: Option<uuid::Uuid>,
}

/// Error type for the get team invites handler
#[derive(Debug, thiserror::Error)]
pub enum GetTeamInvitesError {
    /// The request named a team other than the caller's current team
    #[error("the requested team is not the caller's current team")]
    NotCurrentTeam,
    /// Reading the team's invites failed
    #[error(transparent)]
    TeamError(#[from] TeamError),
}

impl IntoResponse for GetTeamInvitesError {
    fn into_response(self) -> Response {
        match self {
            GetTeamInvitesError::NotCurrentTeam => super::not_current_team_response(),
            GetTeamInvitesError::TeamError(error) => error.into_response(),
        }
    }
}

/// Gets all invites for a team.
#[utoipa::path(
    get,
    path = "/team/invites",
    operation_id = "get_team_invites",
    params(GetTeamInvitesQuery),
    responses(
        (status = 200, body = TeamInvitesResponse),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 409, body = ErrorResponse, description = "`team_id` names a team other than the caller's current team"),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err)]
pub async fn handler<T: TeamService, Eas: EntityAccessService, Auth: MacroAuthorizationService>(
    access: MacroUserTeamExtractorV2<AdminTeamRole, Eas, Auth>,
    State(state): State<TeamRouterState<T, Eas, Auth>>,
    Query(query): Query<GetTeamInvitesQuery>,
) -> Result<Json<TeamInvitesResponse>, GetTeamInvitesError> {
    if !super::is_expected_team(&access.entity_access_receipt, query.team_id) {
        return Err(GetTeamInvitesError::NotCurrentTeam);
    }
    let invites = state
        .service
        .get_team_invites(access.entity_access_receipt)
        .await?;
    Ok(Json(TeamInvitesResponse { invites }))
}
