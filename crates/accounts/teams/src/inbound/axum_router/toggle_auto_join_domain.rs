use axum::{Json, extract::State};
use entity_access::{
    domain::{models::AdminTeamRole, ports::EntityAccessService},
    inbound::axum_extractors::MacroUserTeamExtractorV2,
};
use macro_authorization::MacroAuthorizationService;
use model_error_response::ErrorResponse;

use crate::domain::{model::ToggleAutoJoinDomainError, team_repo::TeamService};

use super::TeamRouterState;

/// Response for the toggle auto-join domain endpoint.
#[derive(serde::Serialize, utoipa::ToSchema)]
pub struct ToggleAutoJoinDomainResponse {
    /// The team's auto-join domain after the toggle (null when it was
    /// unset by this call).
    pub auto_join_domain: Option<String>,
}

/// Toggles automatic domain joining for the team. When the team has no
/// auto-join domain, sets it to the team owner's email domain — rejected
/// with a 400 when that domain is a generic email provider domain (e.g.
/// gmail.com). When one is already set, removes it. New users whose email
/// domain matches a team's auto-join domain are added to that team on
/// signup. Requires the caller to be an Admin or Owner of the team.
#[utoipa::path(
    post,
    path = "/team/auto-join-domain/toggle",
    operation_id = "toggle_team_auto_join_domain",
    responses(
        (status = 200, body = ToggleAutoJoinDomainResponse),
        (status = 400, body = ErrorResponse),
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
) -> Result<Json<ToggleAutoJoinDomainResponse>, ToggleAutoJoinDomainError> {
    let auto_join_domain = state
        .service
        .toggle_auto_join_domain(access.entity_access_receipt)
        .await?;
    Ok(Json(ToggleAutoJoinDomainResponse { auto_join_domain }))
}
