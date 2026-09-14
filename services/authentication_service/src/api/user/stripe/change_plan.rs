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

/// Moves the caller's own seat between paid plans.
///
/// On a paying team this moves only the caller's seat (team admins and the
/// owner may do so; teammates' seats are managed from team settings). Solo
/// subscribers get the price on their subscription's seat item swapped. The
/// proration is invoiced immediately either way; roles and the AI allowance
/// follow at once on a team and from the `customer.subscription.updated`
/// webhook for a personal subscription.
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
        (status = 409, description = "Already on this plan", body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, user), err, fields(user_id = %user.authorization.user.macro_user_id, plan = ?req.plan))]
pub async fn change_plan(
    State(ctx): State<ApiContext>,
    user: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    Json(req): Json<ChangePlanRequest>,
) -> Result<Json<ChangePlanResponse>, StripeOperationError> {
    let target_price = ctx.stripe_prices.price_id(req.plan)?.to_string();
    let user_id = &user.authorization.user.macro_user_id;

    // A member of a paying team is billed through the team: move their seat.
    if let Some(team) = ctx
        .entity_access_service
        .get_user_team(user_id)
        .await
        .map_err(|e| StripeOperationError::TeamsErr(e.into()))?
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
            // A free team bills nobody; fall through to the personal subscription.
            Err(SetTeamMemberPlanError::TeamNotPaying) => {}
            Err(e) => return Err(e.into()),
        }
    }

    let stripe_customer_id = macro_db_client::user::get::get_stripe_customer_id_by_user_id(
        &ctx.db,
        &user.authorization.user.macro_user_id,
    )
    .await?
    .ok_or(StripeOperationError::MissingStripeId)?;
    let customer_id: stripe::CustomerId = stripe_customer_id.parse()?;

    let mut list_subscriptions = stripe::ListSubscriptions::new();
    list_subscriptions.customer = Some(customer_id);
    list_subscriptions.limit = Some(10);
    let subscriptions = stripe::Subscription::list(&ctx.stripe_client, &list_subscriptions).await?;

    let subscription = subscriptions
        .data
        .into_iter()
        .find(|sub| {
            matches!(
                sub.status,
                stripe::SubscriptionStatus::Active | stripe::SubscriptionStatus::Trialing
            )
        })
        .ok_or(StripeOperationError::NoSubscription)?;

    let seat_prices = ctx.stripe_prices.seat_price_ids();
    let seat_item = subscription
        .items
        .data
        .iter()
        .find(|item| {
            item.price
                .as_ref()
                .is_some_and(|price| seat_prices.iter().any(|id| *id == price.id.as_str()))
        })
        .ok_or(StripeOperationError::NoSubscription)?;

    if seat_item
        .price
        .as_ref()
        .is_some_and(|price| price.id.as_str() == target_price)
    {
        return Err(StripeOperationError::AlreadyOnPlan);
    }

    let params = stripe::UpdateSubscription {
        items: Some(vec![stripe::UpdateSubscriptionItems {
            id: Some(seat_item.id.to_string()),
            price: Some(target_price),
            ..Default::default()
        }]),
        proration_behavior: Some(
            stripe::generated::billing::subscription::SubscriptionProrationBehavior::AlwaysInvoice,
        ),
        ..Default::default()
    };
    stripe::Subscription::update(&ctx.stripe_client, &subscription.id, params).await?;

    Ok(Json(ChangePlanResponse { plan: req.plan }))
}
