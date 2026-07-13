use axum::{Json, extract::State};
use entity_access::{
    domain::{models::AdminTeamRole, ports::EntityAccessService},
    inbound::axum_extractors::MacroUserTeamExtractor,
};
use model_error_response::ErrorResponse;

use crate::domain::{
    model::{PatchTeamCrmSettingsRequest, PatchTeamCrmSettingsResponse, TeamError},
    team_repo::TeamService,
};

use super::TeamRouterState;

/// Enables or disables CRM for the team. On enable, kicks off a
/// best-effort backfill that enqueues a `PopulateCrmForUser` message
/// per team member (no-op if CRM is already enabled). On disable,
/// flips the flag and purges the team's CRM data (cascading through
/// `crm_companies` → `crm_domains` / `crm_contacts` /
/// `crm_contact_sources`). Requires the caller to be an Admin or
/// Owner of the team.
#[utoipa::path(
    patch,
    path = "/team/crm",
    operation_id = "patch_team_crm_settings",
    request_body = PatchTeamCrmSettingsRequest,
    responses(
        (status = 200, body = PatchTeamCrmSettingsResponse),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err)]
pub async fn handler<T: TeamService, Eas: EntityAccessService>(
    access: MacroUserTeamExtractor<AdminTeamRole, Eas>,
    State(state): State<TeamRouterState<T, Eas>>,
    Json(req): Json<PatchTeamCrmSettingsRequest>,
) -> Result<Json<PatchTeamCrmSettingsResponse>, TeamError> {
    let response = state
        .service
        .set_team_crm_enabled(access.entity_access_receipt, req.enabled)
        .await?;
    Ok(Json(response))
}
