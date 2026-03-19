use std::collections::HashMap;

use crate::api::context::ApiContext;

use analytics_client::{AnalyticsClient, MetaActionSource, MetaUserData};
use anyhow::Context;
use axum::{
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Json, Response},
};
use macro_user_id::cowlike::CowLike;
use macro_user_id::email::Email;
use model::response::ErrorResponse;
use referral::domain::ports::ReferralService;
use roles_and_permissions::domain::{model::ProductTier, port::UserRolesAndPermissionsService};
use serde::Serialize;
use stripe_webhook::{EventObject, EventType};
use teams::domain::team_repo::TeamService;
use tracing::Instrument;

/// The main entrypoint for all stripe webhook events handling
#[tracing::instrument(skip(ctx, headers, body))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Response, Response> {
    tracing::info!("stripe_webhook");

    let signature = headers
        .get("stripe-signature")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| {
            tracing::error!("missing stripe-signature header");
            (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: "Missing Stripe-Signature header",
                }),
            )
                .into_response()
        })?;

    let payload = std::str::from_utf8(&body).map_err(|e| {
        tracing::error!(error=?e, "invalid UTF-8 in webhook body");
        (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                message: "Invalid webhook payload encoding",
            }),
        )
            .into_response()
    })?;

    // Construct and verify the event
    let event = stripe_webhook::Webhook::construct_event(
        payload,
        signature,
        ctx.stripe_webhook_secret.as_ref(),
    )
    .map_err(|e| {
        tracing::error!(error=?e, "failed to construct stripe event");
        (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                message: "failed to construct stripe event",
            }),
        )
            .into_response()
    })?;

    tracing::info!(
        event_id = %event.id,
        event_type = ?event.type_,
        "processing stripe event"
    );

    let event_type = event.type_.clone();
    match event.type_ {
        EventType::CustomerSubscriptionCreated
        | EventType::CustomerSubscriptionUpdated
        | EventType::CustomerSubscriptionDeleted
        | EventType::CustomerSubscriptionPaused => {
            handle_customer_subscription_event(&ctx, event.data.object, event_type).await
        }
        _ => {
            tracing::error!(event_type=?event.type_, "unexpected event type");
            Ok(())
        }
    }
    .map_err(|e| {
        tracing::error!(error=?e, "unable to handle stripe event");
        (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response()
    })?;

    Ok(StatusCode::OK.into_response())
}

#[tracing::instrument(skip(ctx, event_object), err, ret)]
async fn handle_customer_subscription_event(
    ctx: &ApiContext,
    event_object: EventObject,
    event_type: EventType,
) -> anyhow::Result<()> {
    let subscription = match event_object {
        EventObject::CustomerSubscriptionCreated(subscription) => subscription,
        EventObject::CustomerSubscriptionUpdated(subscription) => subscription,
        EventObject::CustomerSubscriptionDeleted(subscription) => subscription,
        EventObject::CustomerSubscriptionPaused(subscription) => subscription,
        _ => {
            anyhow::bail!("expected subscription");
        }
    };

    if subscription.status.as_str() == "incomplete" {
        return Ok(());
    }

    // Stripe CustomerId and subscription CustomerId are not the same type...
    let customer_id = subscription
        .customer
        .into_id()
        .parse()
        .context("expected customer id")?;

    let customer = stripe::Customer::retrieve(&ctx.stripe_client, &customer_id, &[]).await?;

    tracing::trace!(customer=?customer, "retrieved customer");

    if customer.deleted {
        return Ok(());
    }

    let email = customer.email.context("expected customer email")?;
    let email = Email::parse_from_str(&email)
        .context("expected customer email")?
        .lowercase();

    let subscription_id = subscription.id.as_str();
    let subscription_status = subscription.status.as_str();

    // Extract subscription value and currency for analytics
    let subscription_currency = Some(subscription.currency.to_string());
    let subscription_value: i64 = subscription
        .items
        .data
        .iter()
        .filter_map(|item| {
            let unit_amount = item.price.unit_amount?;
            let quantity = item.quantity.unwrap_or(1) as i64;
            Some(unit_amount * quantity)
        })
        .sum();
    let subscription_value = if subscription_value > 0 {
        Some(subscription_value)
    } else {
        None
    };

    // Extract GA client ID from subscription metadata for analytics tracking
    let ga_client_id = subscription.metadata.get("ga_client_id").cloned();

    tracing::info!(
        email=%email.as_ref(),
        subscription_id,
        subscription_status,
        ga_client_id=?ga_client_id,
        "processing stripe subscription"
    );

    // Get subscription metadata, if this is a team subscription then we need to handle it
    // separately.
    if let Some(team_id) = subscription.metadata.get("team_id") {
        let team_id = macro_uuid::string_to_uuid(team_id)?;
        // We need to handle team subscriptions differently than regular subscriptions.
        return handle_team_subscription_event(
            ctx,
            subscription_id,
            subscription_status,
            &team_id,
            SubscriptionTrackingData {
                ga_client_id: ga_client_id.clone(),
                email: email.as_ref().to_string(),
                value_cents: subscription_value,
                currency: subscription_currency,
                status: subscription_status.to_string(),
                is_new: matches!(event_type, EventType::CustomerSubscriptionCreated),
            },
        )
        .await;
    }

    // Check for duplicate subscriptions
    let mut list_subscriptions = stripe::ListSubscriptions::new();
    list_subscriptions.customer = Some(customer_id.clone());
    list_subscriptions.limit = Some(10);

    let all_subscriptions =
        stripe::Subscription::list(&ctx.stripe_client, &list_subscriptions).await?;

    let active_subscriptions: Vec<_> = all_subscriptions
        .data
        .iter()
        .filter(|sub| {
            matches!(
                sub.status,
                stripe::SubscriptionStatus::Active | stripe::SubscriptionStatus::Trialing
            )
        })
        .collect();

    // If this is a new active/trialing subscription and there are multiple active subscriptions,
    // cancel the newer one (keep the oldest)
    if matches!(subscription_status, "active" | "trialing") && active_subscriptions.len() > 1 {
        // Find the oldest subscription by created timestamp
        let oldest_subscription = active_subscriptions
            .iter()
            .min_by_key(|sub| sub.created)
            .map(|sub| sub.id.as_str());

        // If the current subscription is not the oldest, cancel it
        if oldest_subscription != Some(subscription_id) {
            tracing::warn!(
                customer_id = %customer_id,
                subscription_id = subscription_id,
                oldest_subscription_id = ?oldest_subscription,
                total_active = active_subscriptions.len(),
                "Cancelling duplicate subscription - keeping oldest"
            );

            let sub_id: stripe::SubscriptionId = subscription_id.parse()?;
            stripe::Subscription::cancel(
                &ctx.stripe_client,
                &sub_id,
                stripe::CancelSubscription::default(),
            )
            .await?;

            // Return early - don't update permissions for a cancelled duplicate
            return Ok(());
        }
    }

    // If subscription is being deleted/canceled, check if there's another active subscription
    // before revoking permissions
    if subscription_status == "canceled" && !active_subscriptions.is_empty() {
        tracing::info!(
            customer_id = %customer_id,
            subscription_id = subscription_id,
            remaining_active = active_subscriptions.len(),
            "Subscription deleted but user still has active subscription(s) - not revoking permissions"
        );
        return Ok(());
    }

    if subscription_status == "trialing" {
        // set has_trialed in macro_user table
        macro_db_client::user::patch::update_macro_user_has_trialed(&ctx.db, &email, true).await?;

        // Add has_trialed: true to stripe customer metadata
        let mut params = stripe::UpdateCustomer::new();
        let mut metadata = HashMap::new();
        metadata.insert("has_trialed".to_string(), "true".to_string());
        params.metadata = Some(metadata);

        stripe::Customer::update(&ctx.stripe_client, &customer_id, params).await?;

        tracing::info!(
            customer_id=%customer_id,
            "updated customer metadata with has_trialed=true"
        );
    }

    // Check if this user was referred and process the referral
    if subscription_status == "active"
        && let Err(e) = check_and_process_referral(ctx, &email).await
    {
        tracing::error!(error=?e, "failed to process referral on subscription created");
    }

    // Extract the price ID(s) from the subscription items
    let price_id = subscription
        .items
        .data
        .first() // SAFETY: we only need the first item because we know the user is not in a team
        .map(|item| item.price.id.as_str().to_string())
        .context("no price id attached to subscription")?;

    let product_tier = match price_id.as_str() {
        id if id == ctx.stripe_price_ids.stripe_price_id_haiku.as_ref() => ProductTier::Haiku,
        id if id == ctx.stripe_price_ids.stripe_price_id_sonnet.as_ref() => ProductTier::Sonnet,
        id if id == ctx.stripe_price_ids.stripe_price_id_opus.as_ref() => ProductTier::Opus,
        _ => anyhow::bail!("unsupported price id: {price_id}"),
    };

    ctx.user_roles_and_permissions_service
        .update_user_roles_and_permissions_for_subscription(
            email.clone(),
            subscription_status.try_into()?,
            product_tier,
        )
        .await?;

    // Track conversion events to GA and Meta (fire-and-forget)
    track_stripe_subscription(
        ctx.analytics_client.clone(),
        subscription_id,
        SubscriptionTrackingData {
            ga_client_id,
            email: email.as_ref().to_string(),
            value_cents: subscription_value,
            currency: subscription_currency,
            status: subscription_status.to_string(),
            is_new: matches!(event_type, EventType::CustomerSubscriptionCreated),
        },
    );

    Ok(())
}

/// Checks if the subscribing user was referred and, if so, processes the referral
/// to credit the referrer.
#[tracing::instrument(skip(ctx, email), err)]
async fn check_and_process_referral(
    ctx: &ApiContext,
    email: &Email<macro_user_id::lowercased::Lowercase<'_>>,
) -> anyhow::Result<()> {
    let (macro_user_id, user_id_str) =
        macro_db_client::user::get::get_user_macro_user_id_and_id_by_email(&ctx.db, email.as_ref())
            .await?;

    let Some(referral_code) = ctx
        .referral_service
        .get_referred_by(&macro_user_id)
        .await
        .map_err(|e| anyhow::anyhow!(e))?
    else {
        return Ok(());
    };

    let user_id = macro_user_id::user_id::MacroUserIdStr::parse_from_str(&user_id_str)
        .expect("user id from db should be valid")
        .into_owned();

    ctx.referral_service
        .process_referral(&user_id.0, &referral_code)
        .await
        .map_err(|e| anyhow::anyhow!(e))?;

    Ok(())
}

/// Handles team subscription events.
/// NOTE: We use strs here because there is a mismatch between stripe crate and
/// stripe_webhook crate for these types. *sigh*
#[tracing::instrument(skip(ctx, tracking_data), err, ret)]
async fn handle_team_subscription_event(
    ctx: &ApiContext,
    subscription_id: &str,
    subscription_status: &str,
    team_id: &uuid::Uuid,
    tracking_data: SubscriptionTrackingData,
) -> anyhow::Result<()> {
    if subscription_status == "trialing" {
        anyhow::bail!("unexpected trialing status for team subscription");
    }

    match subscription_status {
        "active" => {
            track_stripe_subscription(ctx.analytics_client.clone(), subscription_id, tracking_data);
            Ok(())
        }
        "canceled" | "past_due" | "paused" | "unpaid" => {
            ctx.teams_service
                .revoke_permissions_for_team_members(team_id)
                .await?;

            track_stripe_subscription(
                ctx.analytics_client.clone(),
                subscription_id,
                SubscriptionTrackingData {
                    is_new: false,
                    ..tracking_data
                },
            );
            Ok(())
        }
        _ => {
            anyhow::bail!("unexpected subscription status for team subscription");
        }
    }
}

#[derive(Debug, Clone, Serialize)]
struct SubscriptionEvent {
    transaction_id: String,
    value: f64,
    currency: String,
}

#[derive(Debug, Clone)]
struct SubscriptionTrackingData {
    ga_client_id: Option<String>,
    email: String,
    value_cents: Option<i64>,
    currency: Option<String>,
    status: String,
    is_new: bool,
}

/// Tracks a Stripe subscription event to GA and Meta (fire-and-forget).
#[tracing::instrument(skip(client, data), fields(subscription_id, email = %data.email, status = %data.status, is_new = data.is_new))]
fn track_stripe_subscription(
    client: std::sync::Arc<AnalyticsClient>,
    subscription_id: &str,
    data: SubscriptionTrackingData,
) {
    let Some(value_cents) = data.value_cents else {
        return;
    };
    let Some(currency) = data.currency else {
        return;
    };

    // Create a child span for the spawned task, linked to the current span
    let task_span = tracing::info_span!(
        parent: tracing::Span::current(),
        "track_stripe_subscription_task"
    );

    let subscription_id = subscription_id.to_string();

    tokio::spawn(
        async move {
            let event = SubscriptionEvent {
                transaction_id: subscription_id.clone(),
                value: value_cents as f64 / 100.0,
                currency: currency.to_uppercase(),
            };
            let user_data = MetaUserData::with_email(&data.email);
            let event_id = Some(subscription_id.as_str());

            match (data.status.as_str(), data.is_new) {
                ("active" | "trialing", true) => {
                    if let Some(ref ga_client_id) = data.ga_client_id
                        && let Err(e) = client.track_ga(ga_client_id, "purchase", &event).await
                    {
                        tracing::warn!(error = ?e, "failed to track GA purchase event");
                    }

                    if let Err(e) = client
                        .track_meta(
                            "Purchase",
                            &user_data,
                            MetaActionSource::Website,
                            event_id,
                            &event,
                        )
                        .await
                    {
                        tracing::warn!(error = ?e, "failed to track Meta purchase event");
                    }
                }
                ("canceled", _) => {
                    if let Some(ref ga_client_id) = data.ga_client_id
                        && let Err(e) = client.track_ga(ga_client_id, "refund", &event).await
                    {
                        tracing::warn!(error = ?e, "failed to track GA refund event");
                    }

                    if let Err(e) = client
                        .track_meta(
                            "CancelSubscription",
                            &user_data,
                            MetaActionSource::Website,
                            event_id,
                            &event,
                        )
                        .await
                    {
                        tracing::warn!(error = ?e, "failed to track Meta cancel event");
                    }
                }
                _ => {}
            }
        }
        .instrument(task_span),
    );
}
