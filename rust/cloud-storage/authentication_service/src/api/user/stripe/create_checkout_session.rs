use axum::{Extension, Json, extract::State};
use serde::Deserialize;
use utoipa::ToSchema;

use super::{StripeOperationError, StripeProductTier, StripeSessionResponse};
use crate::api::context::ApiContext;
use model::response::ErrorResponse;
use model::user::UserContext;

/// Tracking metadata for conversion attribution
#[derive(Debug, Default, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CheckoutSessionMetadata {
    /// Google Analytics client ID for conversion tracking
    pub ga_client_id: Option<String>,
    /// Meta (Facebook) browser ID from _fbp cookie
    pub fbp: Option<String>,
    /// Meta (Facebook) click ID from _fbc cookie
    pub fbc: Option<String>,
}

/// Request body for creating a Stripe checkout session
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateCheckoutSessionRequest {
    /// The URL to redirect to on successful checkout
    pub success_url: String,
    /// The URL to redirect to if checkout is cancelled
    pub cancel_url: String,
    /// Optional discount/promo code to apply
    pub discount: Option<String>,
    /// Tracking metadata for conversion attribution
    #[serde(default)]
    pub metadata: CheckoutSessionMetadata,
    /// The tier, defaults to haiku
    #[serde(default)]
    pub tier: StripeProductTier,
}

/// Creates a Stripe checkout session for the user to subscribe.
#[utoipa::path(
    post,
    path = "/user/stripe/checkout",
    operation_id = "create_checkout_session",
    request_body = CreateCheckoutSessionRequest,
    responses(
        (status = 200, body = StripeSessionResponse),
        (status = 400, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 409, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, user_context), err, fields(user_id = %user_context.user_id))]
pub async fn create_checkout_session(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    Json(req): Json<CreateCheckoutSessionRequest>,
) -> Result<Json<StripeSessionResponse>, StripeOperationError> {
    let user_id =
        macro_user_id::user_id::MacroUserId::parse_from_str(&user_context.user_id)?.lowercase();

    // Get the stripe customer ID from the database
    let stripe_customer_id =
        macro_db_client::user::get::get_stripe_customer_id_by_user_id(&ctx.db, &user_id)
            .await?
            .ok_or(StripeOperationError::MissingStripeId)?;

    let customer_id: stripe::CustomerId = stripe_customer_id.parse()?;

    // Check if user already has an active subscription
    let mut list_subscriptions = stripe::ListSubscriptions::new();
    list_subscriptions.customer = Some(customer_id.clone());
    list_subscriptions.limit = Some(10);

    let subscriptions = stripe::Subscription::list(&ctx.stripe_client, &list_subscriptions).await?;

    let has_active_subscription = subscriptions.data.iter().any(|sub| {
        matches!(
            sub.status,
            stripe::SubscriptionStatus::Active | stripe::SubscriptionStatus::Trialing
        )
    });

    if has_active_subscription {
        tracing::warn!(
            customer_id = %customer_id,
            "User attempted to create checkout session but already has an active subscription"
        );
        return Err(StripeOperationError::AlreadySubscribed);
    }

    // If a discount code is provided, look up the promotion code ID
    let promo_code_id = if let Some(ref discount) = req.discount {
        let mut list_params = stripe::ListPromotionCodes::new();
        list_params.code = Some(discount);
        list_params.active = Some(true);
        list_params.limit = Some(1);

        let promo_codes = stripe::PromotionCode::list(&ctx.stripe_client, &list_params).await?;

        let promo_code = promo_codes
            .data
            .into_iter()
            .next()
            .ok_or(StripeOperationError::PromoCodeNotFound)?;

        Some(promo_code.id)
    } else {
        None
    };

    // Build subscription metadata from optional tracking fields
    let mut metadata = std::collections::HashMap::new();
    if let Some(ga_client_id) = req.metadata.ga_client_id {
        metadata.insert("ga_client_id".to_string(), ga_client_id);
    }
    if let Some(fbp) = req.metadata.fbp {
        metadata.insert("fbp".to_string(), fbp);
    }
    if let Some(fbc) = req.metadata.fbc {
        metadata.insert("fbc".to_string(), fbc);
    }

    // Only set subscription_data if we have metadata to include
    let subscription_data =
        (!metadata.is_empty()).then_some(stripe::CreateCheckoutSessionSubscriptionData {
            metadata: Some(metadata),
            ..Default::default()
        });

    let price_id = match req.tier {
        StripeProductTier::Haiku => ctx.stripe_price_ids.stripe_price_id_haiku.as_ref(),
        StripeProductTier::Sonnet => ctx.stripe_price_ids.stripe_price_id_sonnet.as_ref(),
        StripeProductTier::Opus => ctx.stripe_price_ids.stripe_price_id_opus.as_ref(),
    };

    // Create the checkout session
    let params = stripe::CreateCheckoutSession {
        customer: Some(customer_id),
        mode: Some(stripe::CheckoutSessionMode::Subscription),
        success_url: Some(req.success_url.as_str()),
        cancel_url: Some(req.cancel_url.as_str()),
        allow_promotion_codes: promo_code_id.is_none().then_some(true),
        discounts: promo_code_id.map(|id| {
            vec![stripe::CreateCheckoutSessionDiscounts {
                promotion_code: Some(id.to_string()),
                ..Default::default()
            }]
        }),
        line_items: Some(vec![stripe::CreateCheckoutSessionLineItems {
            price: Some(price_id.to_string()),
            quantity: Some(1),
            ..Default::default()
        }]),
        subscription_data,
        ..Default::default()
    };

    let session = stripe::CheckoutSession::create(&ctx.stripe_client, params).await?;

    let url = session
        .url
        .ok_or(StripeOperationError::UnexpectedStripeResponse)?;

    // Validate but return the exact URL Stripe gave us — session URLs are signed/opaque
    // and `Url::parse(...).to_string()` can normalize in ways that break the signature.
    url::Url::parse(&url).map_err(|_| StripeOperationError::UnexpectedStripeResponse)?;

    Ok(Json(StripeSessionResponse { url }))
}
