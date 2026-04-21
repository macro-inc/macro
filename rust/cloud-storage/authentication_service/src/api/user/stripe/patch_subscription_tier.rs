use std::collections::HashSet;

use axum::{Extension, Json, extract::State};
use macro_user_id::user_id::MacroUserIdStr;
use roles_and_permissions::domain::{
    model::{RoleId, UserRolesAndPermissionsError},
    port::UserRolesAndPermissionsService,
};
use serde::Deserialize;
use strum::IntoEnumIterator;
use teams::domain::team_repo::TeamService;
use utoipa::ToSchema;

use super::{StripeOperationError, StripeProductTier};
use crate::api::context::ApiContext;
use crate::config::StripePriceIds;
use model::response::ErrorResponse;
use model::user::UserContext;

/// Request body for changing the user's subscription tier
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PatchSubscriptionTierRequest {
    /// The new tier to move the user to
    pub new_tier: StripeProductTier,
}

/// Updates the user's subscription tier, swapping both their RBAC role and Stripe subscription line item.
#[utoipa::path(
    patch,
    path = "/user/stripe/subscription",
    operation_id = "patch_subscription_tier",
    request_body = PatchSubscriptionTierRequest,
    responses(
        (status = 200),
        (status = 400, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 409, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, user_context), err, fields(user_id = %user_context.user_id))]
pub async fn patch_subscription_tier(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    Json(req): Json<PatchSubscriptionTierRequest>,
) -> Result<(), StripeOperationError> {
    let user_id = MacroUserIdStr::parse_from_str(&user_context.user_id)?;

    // Team members can't manage their own tier — the team owner's tier change flow
    // (`PATCH /team/{id}/tier`) owns billing for the whole team. Checked before taking the
    // lock so we don't pin a connection for a user who can't use this endpoint anyway.
    if !ctx.teams_service.get_user_teams(&user_id).await?.is_empty() {
        return Err(StripeOperationError::UserInTeam);
    }

    // Serialize concurrent subscription mutations for this user (double-clicks, racing tabs,
    // user + webhook). Lock is released when `txn` is committed or dropped at end of handler.
    let mut txn = ctx.db.begin().await?;
    if !macro_db_client::advisory_lock::try_acquire_user_subscription_xact_lock(&mut txn, &user_id)
        .await?
    {
        return Err(StripeOperationError::SubscriptionUpdateInProgress);
    }

    let new_tier = req.new_tier;
    let new_price_id = price_id_for_tier(&ctx.stripe_price_ids, new_tier);

    let user_roles = ctx
        .user_roles_and_permissions_service
        .get_user_roles(&user_id)
        .await?;

    let old_tier = find_current_sub_tier(&user_roles)?;

    if old_tier == new_tier {
        return Err(StripeOperationError::TierUnchanged);
    }

    let old_price_id = price_id_for_tier(&ctx.stripe_price_ids, old_tier);
    let old_role = tier_to_sub_role(old_tier);
    let new_role = tier_to_sub_role(new_tier);

    let stripe_customer_id =
        macro_db_client::user::get::get_stripe_customer_id_by_user_id(&ctx.db, &user_id)
            .await?
            .ok_or(StripeOperationError::MissingStripeId)?;
    let customer_id: stripe::CustomerId = stripe_customer_id.parse()?;

    let subscription = fetch_active_subscription(&ctx.stripe_client, customer_id).await?;
    let old_item_id = find_subscription_item_id(&subscription, old_price_id)?;

    let roles_service = ctx.user_roles_and_permissions_service.as_ref();
    swap_user_role(roles_service, &user_id, &old_role, &new_role).await?;

    // Stripe idempotency: guarantees a retried call (e.g. our 200 got lost in flight) won't
    // double-apply the tier swap. Key is stable per logical operation; Stripe's own 24h TTL
    // handles the "after some window, treat as new operation" case. Uses an explicit stable
    // string for the tier (rather than `Debug`) so that renaming an enum variant doesn't
    // rotate every in-flight key and break dedup.
    let idempotency_key = format!(
        "patch_subscription_tier:{user_id}:{}:{}:{}",
        tier_key_str(old_tier),
        tier_key_str(new_tier),
        subscription.id,
    );
    let idempotent_client = ctx
        .stripe_client
        .as_ref()
        .clone()
        .with_strategy(stripe::RequestStrategy::Idempotent(idempotency_key.clone()));

    if let Err(stripe_err) = swap_subscription_item(
        &idempotent_client,
        &subscription.id,
        &old_item_id,
        new_price_id,
    )
    .await
    {
        // Include subscription id, prices, and idempotency key so on-call can reconcile:
        // if Stripe actually applied the change server-side but returned a network error,
        // we just rolled back RBAC and left it desynced. The idempotency key + subscription
        // id uniquely identify the operation for manual inspection.
        match rollback_role_swap(roles_service, &user_id, &old_role, &new_role).await {
            Ok(()) => tracing::error!(
                error = ?stripe_err,
                subscription_id = %subscription.id,
                old_price_id = old_price_id,
                new_price_id = new_price_id,
                idempotency_key = %idempotency_key,
                "stripe subscription update failed, role swap rolled back",
            ),
            Err(rollback_err) => tracing::error!(
                error = ?stripe_err,
                rollback_error = ?rollback_err,
                subscription_id = %subscription.id,
                old_price_id = old_price_id,
                new_price_id = new_price_id,
                idempotency_key = %idempotency_key,
                old_role = ?old_role,
                new_role = ?new_role,
                "stripe subscription update failed AND rollback failed — user state inconsistent",
            ),
        }
        return Err(stripe_err.into());
    }

    txn.commit().await?;
    Ok(())
}

/// Maps a subscription tier to the RBAC role a user holds while subscribed at that tier.
fn tier_to_sub_role(tier: StripeProductTier) -> RoleId {
    match tier {
        StripeProductTier::Haiku => RoleId::SubHaiku,
        StripeProductTier::Sonnet => RoleId::SubSonnet,
        StripeProductTier::Opus => RoleId::SubOpus,
    }
}

/// Stable string form of a tier for use in externally-visible keys (idempotency keys, etc.).
/// Must remain stable even if enum variants are renamed — otherwise in-flight idempotency
/// keys would rotate and dedup would break.
fn tier_key_str(tier: StripeProductTier) -> &'static str {
    match tier {
        StripeProductTier::Haiku => "haiku",
        StripeProductTier::Sonnet => "sonnet",
        StripeProductTier::Opus => "opus",
    }
}

/// Returns the Stripe price ID configured for the given tier.
fn price_id_for_tier(price_ids: &StripePriceIds, tier: StripeProductTier) -> &str {
    match tier {
        StripeProductTier::Haiku => price_ids.stripe_price_id_haiku.as_ref(),
        StripeProductTier::Sonnet => price_ids.stripe_price_id_sonnet.as_ref(),
        StripeProductTier::Opus => price_ids.stripe_price_id_opus.as_ref(),
    }
}

/// Identifies the user's current subscription tier by scanning their RBAC role set.
/// Refuses to guess if the user somehow holds more than one Sub\* role — a drifted state that
/// would otherwise let us pick arbitrarily and silently leave the other role behind.
#[tracing::instrument(skip(roles), err)]
fn find_current_sub_tier(
    roles: &HashSet<RoleId>,
) -> Result<StripeProductTier, StripeOperationError> {
    let matches: Vec<StripeProductTier> = StripeProductTier::iter()
        .filter(|tier| roles.contains(&tier_to_sub_role(*tier)))
        .collect();

    match matches.as_slice() {
        [] => Err(StripeOperationError::NoSubscriptionRole),
        [tier] => Ok(*tier),
        tiers => {
            tracing::error!(
                tiers = ?tiers,
                "user holds multiple Sub* roles — refusing to change tier",
            );
            Err(StripeOperationError::InconsistentSubscriptionRoles)
        }
    }
}

/// Fetches the customer's single active Stripe subscription. Solo users are expected to have
/// exactly one; this endpoint is blocked for team members earlier in the handler, so a customer
/// with zero active subs here is genuinely "nothing to patch" and surfaces as 404.
#[tracing::instrument(skip(stripe_client), err, fields(customer_id = %customer_id))]
async fn fetch_active_subscription(
    stripe_client: &stripe::Client,
    customer_id: stripe::CustomerId,
) -> Result<stripe::Subscription, StripeOperationError> {
    let mut list_params = stripe::ListSubscriptions::new();
    list_params.customer = Some(customer_id);
    list_params.status = Some(stripe::SubscriptionStatusFilter::Active);
    list_params.limit = Some(1);

    stripe::Subscription::list(stripe_client, &list_params)
        .await?
        .data
        .into_iter()
        .next()
        .ok_or(StripeOperationError::NoActiveSubscription)
}

/// Finds the subscription line item whose price matches `price_id` and returns its id.
/// Returning `UnexpectedStripeResponse` here would indicate Stripe is in a state we don't model
/// (e.g. the user's role points at a tier their subscription no longer contains).
fn find_subscription_item_id(
    subscription: &stripe::Subscription,
    price_id: &str,
) -> Result<String, StripeOperationError> {
    subscription
        .items
        .data
        .iter()
        .find(|item| {
            item.price
                .as_ref()
                .map(|p| p.id.as_str() == price_id)
                .unwrap_or(false)
        })
        .map(|item| item.id.to_string())
        .ok_or(StripeOperationError::UnexpectedStripeResponse)
}

/// Swaps a user's subscription tier role: upserts `new_role`, then removes `old_role`.
///
/// Ordering matters: upsert-then-remove means a partial failure leaves the user with *both*
/// roles (transient multi-role state, caught by `find_current_sub_tier` on the next request),
/// whereas remove-then-upsert could leave them with *zero* Sub roles and locked out of their
/// plan.
#[tracing::instrument(skip(service), err, fields(user_id = %user_id, old_role = ?old_role, new_role = ?new_role))]
async fn swap_user_role<S: UserRolesAndPermissionsService>(
    service: &S,
    user_id: &MacroUserIdStr<'_>,
    old_role: &RoleId,
    new_role: &RoleId,
) -> Result<(), UserRolesAndPermissionsError> {
    service
        .dangerous_upsert_roles_for_user(user_id, one_role(new_role))
        .await?;

    service
        .dangerous_remove_roles_from_user(user_id, &one_role(old_role))
        .await?;

    Ok(())
}

/// Wraps a single role in a `NonEmpty` slice. Infallible: the slice always has length 1.
fn one_role(role: &RoleId) -> non_empty::NonEmpty<&[RoleId]> {
    non_empty::NonEmpty::new(std::slice::from_ref(role))
        .expect("slice::from_ref always yields a non-empty slice")
}

/// Swaps the subscription's line item from `old_item_id` to a new item at `new_price_id`.
///
/// Uses delete-old + add-new (quantity 1) in a single `Subscription::update` call rather than
/// mutating the existing item's price, matching the pattern used by the teams tier-swap code
/// path. `AlwaysInvoice` proration bills the pro-rated difference immediately so the customer
/// isn't charged the full new rate on their next cycle.
#[tracing::instrument(
    skip(stripe_client),
    err,
    fields(subscription_id = %subscription_id, old_item_id = old_item_id, new_price_id = new_price_id),
)]
async fn swap_subscription_item(
    stripe_client: &stripe::Client,
    subscription_id: &stripe::SubscriptionId,
    old_item_id: &str,
    new_price_id: &str,
) -> Result<(), stripe::StripeError> {
    let update_params = stripe::UpdateSubscription {
        items: Some(vec![
            stripe::UpdateSubscriptionItems {
                id: Some(old_item_id.to_string()),
                deleted: Some(true),
                ..Default::default()
            },
            stripe::UpdateSubscriptionItems {
                price: Some(new_price_id.to_string()),
                quantity: Some(1),
                ..Default::default()
            },
        ]),
        proration_behavior: Some(
            stripe::generated::billing::subscription::SubscriptionProrationBehavior::AlwaysInvoice,
        ),
        ..Default::default()
    };

    stripe::Subscription::update(stripe_client, subscription_id, update_params).await?;
    Ok(())
}

/// Reverts the role swap after a failed Stripe update.
///
/// On failure the caller is responsible for logging — combining the rollback error with the
/// originating Stripe error in a single structured log line gives alerting a complete picture
/// of the inconsistent state.
#[tracing::instrument(skip(service), err, fields(user_id = %user_id, old_role = ?old_role, new_role = ?new_role))]
async fn rollback_role_swap<S: UserRolesAndPermissionsService>(
    service: &S,
    user_id: &MacroUserIdStr<'_>,
    old_role: &RoleId,
    new_role: &RoleId,
) -> Result<(), UserRolesAndPermissionsError> {
    swap_user_role(service, user_id, new_role, old_role).await
}
