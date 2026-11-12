use axum::{Json, extract::State};
use entity_access::{
    domain::{models::AdminTeamRole, ports::EntityAccessService},
    inbound::axum_extractors::MacroUserTeamExtractorV2,
};
use macro_authorization::MacroAuthorizationService;
use model_error_response::ErrorResponse;

use crate::domain::{
    model::{PatchTeamRequest, TeamError},
    team_repo::TeamService,
};

use super::TeamRouterState;

/// Updates a team.
#[utoipa::path(
    patch,
    path = "/team",
    operation_id = "patch_team",
    request_body = PatchTeamRequest,
    responses(
        (status = 200),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err)]
pub async fn handler<T: TeamService, Eas: EntityAccessService, Auth: MacroAuthorizationService>(
    access: MacroUserTeamExtractorV2<AdminTeamRole, Eas, Auth>,
    State(state): State<TeamRouterState<T, Eas, Auth>>,
    Json(req): Json<PatchTeamRequest>,
) -> Result<(), TeamError> {
    state
        .service
        .patch_team(access.entity_access_receipt, &req)
        .await?;
    Ok(())
}
