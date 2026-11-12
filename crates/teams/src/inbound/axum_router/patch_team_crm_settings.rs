use axum::{Json, extract::State};
use entity_access::{
    domain::{models::AdminTeamRole, ports::EntityAccessService},
    inbound::axum_extractors::MacroUserTeamExtractorV2,
};
use macro_authorization::MacroAuthorizationService;
use model_error_response::ErrorResponse;

use crate::domain::{
    model::{PatchTeamCrmSettingsRequest, PatchTeamCrmSettingsResponse, TeamError},
    team_repo::TeamService,
};

use super::TeamRouterState;

/// Legacy compatibility endpoint for team admins and owners. Enabling
/// is a no-op; disabling is rejected. CRM records remain available.
/// Each member manages mailbox contribution through `/crm/email-privacy`;
/// this endpoint does not enroll mailboxes, backfill emails, or purge records.
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
pub async fn handler<T: TeamService, Eas: EntityAccessService, Auth: MacroAuthorizationService>(
    access: MacroUserTeamExtractorV2<AdminTeamRole, Eas, Auth>,
    State(state): State<TeamRouterState<T, Eas, Auth>>,
    Json(req): Json<PatchTeamCrmSettingsRequest>,
) -> Result<Json<PatchTeamCrmSettingsResponse>, TeamError> {
    let response = state
        .service
        .set_team_crm_enabled(access.entity_access_receipt, req.enabled, req.backfill)
        .await?;
    Ok(Json(response))
}
