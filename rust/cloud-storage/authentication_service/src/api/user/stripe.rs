use std::sync::LazyLock;

use axum::{
    Extension, Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_env_var::env_var;
use serde::{Deserialize, Serialize};
use stripe::{ParseIdError, StripeError};
use thiserror::Error;
use utoipa::ToSchema;

use crate::api::context::ApiContext;
use model::user::UserContext;

// Shared error type for Stripe operations
#[derive(Debug, Error)]
pub enum StripeOperationError {
    #[error("Failed to parse user id")]
    ParseId(#[from] macro_user_id::error::ParseErr),
    #[error("Internal server error")]
    DbErr(#[from] sqlx::Error),
    #[error("User does not have a stripe id")]
    MissingStripeId,
    #[error("Invalid stripe id")]
    StripeIdParse(#[from] ParseIdError),
    #[error("Internal stripe error")]
    StripeErr(#[from] StripeError),
    #[error("Invalid promo code")]
    PromoCodeNotFound,
    #[error("Internal server error")]
    UnexpectedStripeResponse,
}

impl IntoResponse for StripeOperationError {
    fn into_response(self) -> Response {
        let status = match &self {
            StripeOperationError::ParseId(_) => StatusCode::BAD_REQUEST,
            StripeOperationError::DbErr(_) => StatusCode::INTERNAL_SERVER_ERROR,
            StripeOperationError::MissingStripeId => StatusCode::BAD_REQUEST,
            StripeOperationError::StripeIdParse(_) => StatusCode::BAD_REQUEST,
            StripeOperationError::StripeErr(_) => StatusCode::INTERNAL_SERVER_ERROR,
            StripeOperationError::PromoCodeNotFound => StatusCode::NOT_FOUND,
            StripeOperationError::UnexpectedStripeResponse => StatusCode::INTERNAL_SERVER_ERROR,
        };
        (status, self.to_string()).into_response()
    }
}

env_var!(
    struct StripePremiumPriceId;
);

static STRIPE_PRICE_ID: LazyLock<StripePremiumPriceId> = LazyLock::new(|| {
    match StripePremiumPriceId::new() {
        Ok(var) => var,
        // just use this non secret value if the value doesn't exist
        Err(_) => StripePremiumPriceId::Comptime("price_1PnSgXJaD7zvQeOBfSYgOmZc"),
    }
});

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
}

/// Response containing the Stripe session URL
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct StripeSessionResponse {
    /// The URL to redirect the user to
    pub url: String,
}

/// Request body for creating a Stripe portal session
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreatePortalSessionRequest {
    /// The URL to redirect to after leaving the portal
    pub return_url: String,
}

/// Creates a Stripe checkout session for the user to subscribe.
#[utoipa::path(
    post,
    path = "/user/stripe/checkout",
    operation_id = "create_checkout_session",
    request_body = CreateCheckoutSessionRequest,
    responses(
        (status = 200, body = StripeSessionResponse),
        (status = 400, body = String),
        (status = 404, body = String),
        (status = 500, body = String),
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
            price: Some(STRIPE_PRICE_ID.as_ref().to_string()),
            quantity: Some(1),
            ..Default::default()
        }]),
        ..Default::default()
    };

    let session = stripe::CheckoutSession::create(&ctx.stripe_client, params).await?;

    let url = session
        .url
        .ok_or(StripeOperationError::UnexpectedStripeResponse)?;

    let url = url::Url::parse(&url).map_err(|_| StripeOperationError::UnexpectedStripeResponse)?;

    Ok(Json(StripeSessionResponse {
        url: url.to_string(),
    }))
}

/// Creates a Stripe billing portal session.
#[utoipa::path(
    post,
    path = "/user/stripe/portal",
    operation_id = "create_portal_session",
    request_body = CreatePortalSessionRequest,
    responses(
        (status = 200, body = StripeSessionResponse),
        (status = 400, body = String),
        (status = 500, body = String),
    )
)]
#[tracing::instrument(skip(ctx, user_context), err, fields(user_id = %user_context.user_id))]
pub async fn create_portal_session(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    Json(req): Json<CreatePortalSessionRequest>,
) -> Result<Json<StripeSessionResponse>, StripeOperationError> {
    let user_id =
        macro_user_id::user_id::MacroUserId::parse_from_str(&user_context.user_id)?.lowercase();

    // Get the stripe customer ID from the database
    let stripe_customer_id =
        macro_db_client::user::get::get_stripe_customer_id_by_user_id(&ctx.db, &user_id)
            .await?
            .ok_or(StripeOperationError::MissingStripeId)?;

    let customer_id: stripe::CustomerId = stripe_customer_id.parse()?;

    // Create the billing portal session
    let mut params = stripe::CreateBillingPortalSession::new(customer_id);
    params.return_url = Some(req.return_url.as_str());

    let session = stripe::BillingPortalSession::create(&ctx.stripe_client, params).await?;

    let url = url::Url::parse(&session.url)
        .map_err(|_| StripeOperationError::UnexpectedStripeResponse)?;

    Ok(Json(StripeSessionResponse {
        url: url.to_string(),
    }))
}
