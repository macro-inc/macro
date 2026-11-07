use axum::{Json, extract::State};
use entity_access::{
    domain::{models::AdminTeamRole, ports::EntityAccessService},
    inbound::axum_extractors::MacroUserTeamExtractorV2,
};
use macro_authorization::MacroAuthorizationService;
use model_error_response::ErrorResponse;

use crate::domain::team_repo::TeamService;

use super::TeamRouterState;

/// Response for the toggle non-admin invites endpoint.
#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct ToggleNonAdminInvitesResponse {
    /// Whether non-admin members may invite users to the team after the
    /// toggle.
    pub allow_non_admin_invites: bool,
}

/// Toggles whether non-admin members may invite users to the team. Teams
/// start with this on (any member can invite); turning it off restricts
/// inviting to team admins and owners. Requires the caller to be an Admin
/// or Owner of the team.
#[utoipa::path(
    post,
    path = "/team/non-admin-invites/toggle",
    operation_id = "toggle_team_non_admin_invites",
    responses(
        (status = 200, body = ToggleNonAdminInvitesResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err)]
pub async fn handler<T: TeamService, Eas: EntityAccessService, Auth: MacroAuthorizationService>(
    access: MacroUserTeamExtractorV2<AdminTeamRole, Eas, Auth>,
    State(state): State<TeamRouterState<T, Eas, Auth>>,
) -> Result<Json<ToggleNonAdminInvitesResponse>, crate::domain::model::TeamError> {
    let allow_non_admin_invites = state
        .service
        .toggle_allow_non_admin_invites(access.entity_access_receipt)
        .await?;
    Ok(Json(ToggleNonAdminInvitesResponse {
        allow_non_admin_invites,
    }))
}
