use axum::{Json, extract::State};
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use serde::{Deserialize, Serialize};
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

/// Moves the caller's active subscription between paid plans.
///
/// Swaps the per-seat price on the subscription's seat item and invoices the
/// proration immediately. Roles and the AI allowance follow from the
/// `customer.subscription.updated` webhook. For a team subscription every
/// seat moves together.
#[utoipa::path(
    post,
    path = "/user/stripe/plan",
    operation_id = "change_plan",
    request_body = ChangePlanRequest,
    responses(
        (status = 200, body = ChangePlanResponse),
        (status = 400, description = "Plan not available", body = ErrorResponse),
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
