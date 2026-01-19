use std::sync::LazyLock;

use axum::{
    Extension, Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_env_var::env_var;
use macro_user_id::user_id::MacroUserId;
use serde::{Deserialize, Serialize};
use stripe::{ParseIdError, StripeError};
use utoipa::ToSchema;

use crate::api::context::ApiContext;
use model::{response::ErrorResponse, user::UserContext};

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

/// Response containing the Stripe checkout session URL
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateCheckoutSessionResponse {
    /// The URL to redirect the user to for checkout
    pub url: String,
}

#[derive(Debug, thiserror::Error)]
pub enum CreateCheckoutSessionError {
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

impl IntoResponse for CreateCheckoutSessionError {
    fn into_response(self) -> Response {
        let status = match &self {
            CreateCheckoutSessionError::ParseId(_) => StatusCode::BAD_REQUEST,
            CreateCheckoutSessionError::DbErr(_) => StatusCode::INTERNAL_SERVER_ERROR,
            CreateCheckoutSessionError::MissingStripeId => StatusCode::BAD_REQUEST,
            CreateCheckoutSessionError::StripeIdParse(_) => StatusCode::BAD_REQUEST,
            CreateCheckoutSessionError::StripeErr(_) => StatusCode::INTERNAL_SERVER_ERROR,
            CreateCheckoutSessionError::PromoCodeNotFound => StatusCode::NOT_FOUND,
            CreateCheckoutSessionError::UnexpectedStripeResponse => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
        };
        (
            status,
            Json(ErrorResponse {
                message: &self.to_string(),
            }),
        )
            .into_response()
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

/// Creates a Stripe checkout session for the user to subscribe.
#[utoipa::path(
    post,
    path = "/user/stripe/checkout",
    operation_id = "create_checkout_session",
    request_body = CreateCheckoutSessionRequest,
    responses(
        (status = 200, body = CreateCheckoutSessionResponse),
        (status = 400, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, user_context), err, fields(user_id = %user_context.user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    Json(req): Json<CreateCheckoutSessionRequest>,
) -> Result<Json<CreateCheckoutSessionResponse>, CreateCheckoutSessionError> {
    let user_id = MacroUserId::parse_from_str(&user_context.user_id)?.lowercase();

    // Get the stripe customer ID from the database
    let stripe_customer_id =
        macro_db_client::user::get::get_stripe_customer_id_by_user_id(&ctx.db, &user_id)
            .await?
            .ok_or(CreateCheckoutSessionError::MissingStripeId)?;

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
            .ok_or(CreateCheckoutSessionError::PromoCodeNotFound)?;

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
        .ok_or(CreateCheckoutSessionError::UnexpectedStripeResponse)?;

    let url = url::Url::parse(&url)
        .map_err(|_| CreateCheckoutSessionError::UnexpectedStripeResponse)?;

    Ok(Json(CreateCheckoutSessionResponse {
        url: url.to_string(),
    }))
}
