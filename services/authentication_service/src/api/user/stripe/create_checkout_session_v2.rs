use axum::{Json, extract::State};
use entity_access::domain::models::OwnerTeamRole;
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::OptionalMacroUserTeamExtractorV2;
use gtm_invite::domain::ports::GtmInviteService;
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use macro_user_id::user_id::MacroUserIdStr;
use serde::Deserialize;
use utoipa::ToSchema;

use super::{StripeOperationError, StripeSessionResponse};
use crate::api::context::{ApiContext, AuthorizationService};
use model::response::ErrorResponse;

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
pub struct CreateCheckoutSessionV2Request {
    /// The URL to redirect to on successful checkout
    pub success_url: String,
    /// The URL to redirect to if checkout is cancelled
    pub cancel_url: String,
    /// Optional discount/promo code to apply
    pub discount: Option<String>,
    /// Tracking metadata for conversion attribution
    #[serde(default)]
    pub metadata: CheckoutSessionMetadata,
}

/// Creates a Stripe checkout session for the user to subscribe.
#[utoipa::path(
    post,
    path = "/user/stripe/checkoutv2",
    operation_id = "create_checkout_session_v2",
    request_body = CreateCheckoutSessionV2Request,
    responses(
        (status = 200, body = StripeSessionResponse),
        (status = 400, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 409, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, user, optional_team), err, fields(user_id = %user.authorization.user.macro_user_id))]
pub async fn create_checkout_session<Eas: EntityAccessService>(
    State(ctx): State<ApiContext>,
    user: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    optional_team: OptionalMacroUserTeamExtractorV2<OwnerTeamRole, Eas, AuthorizationService>,
    Json(req): Json<CreateCheckoutSessionV2Request>,
) -> Result<Json<StripeSessionResponse>, StripeOperationError> {
    // Get the stripe customer ID from the database
    let stripe_customer_id = macro_db_client::user::get::get_stripe_customer_id_by_user_id(
        &ctx.db,
        &user.authorization.user.macro_user_id,
    )
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

    // An explicit discount code is authoritative and must exist. Without one,
    // an account that signed up through a GTM invite link gets the link's
    // promotion applied for it — best-effort, so a code that went missing in
    // Stripe degrades to a regular checkout instead of blocking it.
    let promo_code_id = match req.discount.as_deref() {
        Some(discount) => Some(
            find_active_promotion_code(&ctx.stripe_client, discount)
                .await?
                .ok_or(StripeOperationError::PromoCodeNotFound)?,
        ),
        None => match gtm_invite_promo_code(&ctx, &user.authorization.user.macro_user_id).await {
            Some(code) => match find_active_promotion_code(&ctx.stripe_client, &code).await {
                Ok(Some(id)) => {
                    tracing::info!(promo_code = %code, "applying GTM invite promotion to checkout");
                    Some(id)
                }
                Ok(None) => {
                    tracing::error!(
                        promo_code = %code,
                        "GTM invite promotion code is not active in Stripe; checking out without it"
                    );
                    None
                }
                Err(e) => {
                    tracing::error!(
                        error=?e,
                        promo_code = %code,
                        "failed to look up GTM invite promotion code; checking out without it"
                    );
                    None
                }
            },
            None => None,
        },
    };

    // Build subscription metadata from optional tracking fields
    let mut metadata = std::collections::HashMap::new();

    // If the user is the owner of a team, we need to insert team metadata into subscription
    if let Some(team) = optional_team.entity_access_receipt {
        let team_id = team.entity().entity_id.clone();
        metadata.insert("team_id".to_string(), team_id);

        metadata.insert(
            "owner_id".to_string(),
            user.authorization.user.macro_user_id.to_string(),
        );
    }

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

    let price_id = ctx.stripe_price_id;

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

/// Finds the active Stripe promotion code customers redeem as `code`.
async fn find_active_promotion_code(
    stripe_client: &stripe::Client,
    code: &str,
) -> Result<Option<stripe::PromotionCodeId>, stripe::StripeError> {
    let mut list_params = stripe::ListPromotionCodes::new();
    list_params.code = Some(code);
    list_params.active = Some(true);
    list_params.limit = Some(1);

    let promo_codes = stripe::PromotionCode::list(stripe_client, &list_params).await?;

    Ok(promo_codes.data.into_iter().next().map(|promo| promo.id))
}

/// The promotion code an account holds from a redeemed GTM invite link, if any.
async fn gtm_invite_promo_code(ctx: &ApiContext, user_id: &MacroUserIdStr<'_>) -> Option<String> {
    match ctx.gtm_invite_service.active_offer_for_user(user_id).await {
        Ok(Some(link)) => Some(link.promo_code.to_string()),
        Ok(None) => None,
        Err(e) => {
            tracing::error!(error=?e, "failed to look up GTM invite offer for checkout");
            None
        }
    }
}
