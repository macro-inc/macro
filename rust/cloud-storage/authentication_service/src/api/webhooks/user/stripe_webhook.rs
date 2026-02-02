use std::collections::HashMap;

use crate::api::context::ApiContext;
use anyhow::Context;
use axum::{
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Json, Response},
};
use macro_user_id::email::Email;
use model::response::ErrorResponse;
use roles_and_permissions::domain::port::UserRolesAndPermissionsService;
use stripe_webhook::{EventObject, EventType};
use teams::domain::team_repo::TeamService;

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

    match event.type_ {
        EventType::CustomerSubscriptionCreated
        | EventType::CustomerSubscriptionUpdated
        | EventType::CustomerSubscriptionDeleted
        | EventType::CustomerSubscriptionPaused => {
            handle_customer_subscription_event(&ctx, event.data.object).await
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

    tracing::info!(
        email=%email.as_ref(),
        subscription_id,
        subscription_status,
        "processing stripe subscription"
    );

    // Get subscription metadata, if this is a team subscription then we need to handle it
    // separately.
    if let Some(team_id) = subscription.metadata.get("team_id") {
        let team_id = macro_uuid::string_to_uuid(team_id)?;
        // We need to handle team subscriptions differently than regular subscriptions.
        return handle_team_subscription_event(ctx, subscription_id, subscription_status, &team_id)
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

    ctx.user_roles_and_permissions_service
        .update_user_roles_and_permissions_for_subscription(email, subscription_status.try_into()?)
        .await?;

    Ok(())
}

/// Handles team subscription events.
/// NOTE: We use strs here because there is a mismatch between stripe crate and
/// stripe_webhook crate for these types. *sigh*
#[tracing::instrument(skip(ctx), err, ret)]
async fn handle_team_subscription_event(
    ctx: &ApiContext,
    subscription_id: &str,
    subscription_status: &str,
    team_id: &uuid::Uuid,
) -> anyhow::Result<()> {
    if subscription_status == "trialing" {
        anyhow::bail!("unexpected trialing status for team subscription");
    }

    match subscription_status {
        // Subscription is active, we do not need to do anything.
        // Perhaps eventually we would have a "paused" status on the team we'd want to update
        "active" => Ok(()),
        // If the stripe subscription is somehow cancelled, we need to remove roles from the team
        // members.
        "canceled" | "past_due" | "paused" | "unpaid" => {
            ctx.teams_service
                .revoke_permissions_for_team_members(team_id)
                .await?;
            Ok(())
        }
        _ => {
            anyhow::bail!("unexpected subscription status for team subscription");
        }
    }
}
