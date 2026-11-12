use axum::{Json, extract::State};
use entity_access::domain::ports::EntityAccessService;
use macro_authorization::{MacroAuthorizationExtractor, MacroAuthorizationService, UserOrInternal};
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

/// Gets all of a user's invitations.
#[utoipa::path(
    get,
    path = "/team/user/invites",
    operation_id = "get_user_invites",
    responses(
        (status = 200, body = TeamInvitesResponse),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err)]
pub async fn handler<T: TeamService, Eas: EntityAccessService, Auth: MacroAuthorizationService>(
    State(state): State<TeamRouterState<T, Eas, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
) -> Result<Json<TeamInvitesResponse>, TeamError> {
    let invites = state
        .service
        .get_user_invites(&authorization.authorization.user.macro_user_id)
        .await?;
    Ok(Json(TeamInvitesResponse { invites }))
}
