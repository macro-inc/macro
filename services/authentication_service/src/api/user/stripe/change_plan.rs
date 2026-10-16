use axum::{Json, extract::State};
use entity_access::domain::{
    models::{AdminTeamRole, Entity, EntityAccessReceipt, EntityPermission, EntityType},
    ports::EntityAccessService,
};
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use macro_user_id::cowlike::CowLike;
use serde::{Deserialize, Serialize};
use teams::domain::{model::SetTeamMemberPlanError, team_repo::TeamService};
use utoipa::ToSchema;

use super::{PaidPlan, StripeOperationError};
use crate::api::context::{ApiContext, AuthorizationService};
use model::response::ErrorResponse;

/// Request body for switching plans
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChangePlanRequest {
    /// The plan to move the active subscription to
    pub plan: PaidPlan,
}

/// Response for a plan change
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChangePlanResponse {
    /// The plan the subscription is now on
    pub plan: PaidPlan,
}

/// Changes the caller's paid plan. Upgrades are prorated immediately;
/// downgrades retain the active plan until renewal. Selecting the active plan
/// cancels a pending downgrade without charging or resetting usage.
#[utoipa::path(
    post,
    path = "/user/stripe/plan",
    operation_id = "change_plan",
    request_body = ChangePlanRequest,
    responses(
        (status = 200, body = ChangePlanResponse),
        (status = 400, description = "Plan not available", body = ErrorResponse),
        (status = 402, description = "The team has no active subscription", body = ErrorResponse),
        (status = 403, description = "Only team admins change plans on a team", body = ErrorResponse),
        (status = 404, description = "No active subscription", body = ErrorResponse),
        (status = 409, description = "More than one active subscription", body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, user), err, fields(user_id = %user.authorization.user.macro_user_id, plan = ?req.plan))]
pub async fn change_plan(
    State(ctx): State<ApiContext>,
    user: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    Json(req): Json<ChangePlanRequest>,
) -> Result<Json<ChangePlanResponse>, StripeOperationError> {
    let user_id = &user.authorization.user.macro_user_id;

    // A member of a team billed per seat is billed through the team: move
    // their seat. A free team bills nobody, so its members (admin or not)
    // change their own personal subscription below.
    if let Some(team) = ctx
        .entity_access_service
        .get_user_team(user_id)
        .await
        .map_err(|e| StripeOperationError::TeamsErr(e.into()))?
        && ctx.teams_service.team_bills_per_seat(&team.team_id).await?
    {
        let receipt = EntityAccessReceipt::<AdminTeamRole>::try_new_authenticated_user(
            user_id.clone().into_owned(),
            Entity {
                entity_id: team.team_id.to_string(),
                entity_type: EntityType::Team,
            },
            EntityPermission::TeamRole { role: team.role },
        )
        .map_err(|_| StripeOperationError::NotTeamAdmin)?;
        match ctx
            .teams_service
            .set_team_member_plan(receipt, user_id, req.plan)
            .await
        {
            Ok(member) => return Ok(Json(ChangePlanResponse { plan: member.plan })),
            // The team stopped paying between the two calls: personal it is.
            Err(SetTeamMemberPlanError::TeamNotPaying) => {}
            Err(e) => return Err(e.into()),
        }
    }

    let plan = ctx.subscription_plan.change(user_id, req.plan).await?;
    Ok(Json(ChangePlanResponse { plan }))
}
