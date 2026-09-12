use axum::{
    Json,
    extract::{Path, State},
};
use entity_access::{
    domain::{models::AdminTeamRole, ports::EntityAccessService},
    inbound::axum_extractors::MacroUserTeamExtractorV2,
};
use macro_authorization::MacroAuthorizationService;
use macro_user_id::user_id::MacroUserIdStr;
use model_error_response::ErrorResponse;

use crate::domain::{
    model::{PatchTeamMemberPlanRequest, SetTeamMemberPlanError, TeamMember},
    team_repo::TeamService,
};

use super::TeamRouterState;

/// Path parameters for the member plan endpoint.
#[derive(serde::Deserialize)]
pub struct Param {
    /// The member whose seat plan changes.
    pub member_user_id: MacroUserIdStr<'static>,
}

/// Moves one team member's seat between paid plans.
///
/// Team admins and owners only. The team's subscription is re-billed for
/// the seat at once (prorated); the member's tier role and the team's pooled
/// AI allowance follow immediately.
#[utoipa::path(
    patch,
    path = "/team/members/{member_user_id}/plan",
    operation_id = "patch_team_member_plan",
    params(
        ("member_user_id" = String, Path, description = "The member whose seat plan changes")
    ),
    request_body = PatchTeamMemberPlanRequest,
    responses(
        (status = 200, body = TeamMember),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 402, description = "The team has no active subscription", body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip_all, err, fields(member = %member_user_id, plan = %req.plan))]
pub async fn handler<T: TeamService, Eas: EntityAccessService, Auth: MacroAuthorizationService>(
    access: MacroUserTeamExtractorV2<AdminTeamRole, Eas, Auth>,
    State(state): State<TeamRouterState<T, Eas, Auth>>,
    Path(Param { member_user_id }): Path<Param>,
    Json(req): Json<PatchTeamMemberPlanRequest>,
) -> Result<Json<TeamMember<'static>>, SetTeamMemberPlanError> {
    let member = state
        .service
        .set_team_member_plan(access.entity_access_receipt, &member_user_id, req.plan)
        .await?;
    Ok(Json(member))
}
