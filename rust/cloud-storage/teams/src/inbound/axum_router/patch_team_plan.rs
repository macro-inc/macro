use axum::{Json, extract::State};
use entity_access::{
    domain::{models::OwnerTeamRole, ports::EntityAccessService},
    inbound::axum_extractors::MacroUserTeamExtractor,
};
use model_error_response::ErrorResponse;

use crate::domain::{
    model::{PatchTeamPlanRequest, TeamError},
    team_repo::TeamService,
};

use super::TeamRouterState;

/// Updates a team plan.
#[utoipa::path(
    patch,
    path = "/team/plan",
    operation_id = "patch_team_plan",
    request_body = PatchTeamPlanRequest,
    responses(
        (status = 200),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err)]
pub async fn handler<T: TeamService, Eas: EntityAccessService>(
    access: MacroUserTeamExtractor<OwnerTeamRole, Eas>,
    State(state): State<TeamRouterState<T, Eas>>,
    Json(req): Json<PatchTeamPlanRequest>,
) -> Result<(), TeamError> {
    state
        .service
        .update_team_plan(access.entity_access_receipt, &req)
        .await?;
    Ok(())
}
