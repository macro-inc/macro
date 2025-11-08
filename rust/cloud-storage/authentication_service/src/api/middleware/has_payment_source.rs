//! This module provides the stripe_customer_id and default_pm_id in the request context.

// TODO: this should be grabbed from macrodb which is populated through webhooks to save a lot of time and potential rate limiting issues calling stripe.
use std::sync::Arc;

use axum::{
    Extension, Json, RequestPartsExt, async_trait,
    extract::{FromRef, FromRequestParts},
    http::{StatusCode, request::Parts},
    response::{IntoResponse, Response},
};
use macro_user_id::user_id::MacroUserId;
use model::{response::ErrorResponse, user::UserContext};
use sqlx::PgPool;
use thiserror::Error;

#[derive(Debug)]
pub struct StripeCustomerExtractor {
    /// The users stripe customer id
    #[allow(dead_code)]
    pub stripe_customer_id: stripe::CustomerId,
    /// The payment source id for the customer
    #[allow(dead_code)]
    pub default_pm_id: stripe::PaymentMethodId,
}

/// Possible errors when getting stripe customer information for the user
#[derive(Debug, Error)]
pub enum StripeCustomerError {
    /// The user does not have a stripe customer id
    #[error("No stripe customer id")]
    NoStripeCustomerId,
    #[error("Invalid stripe customer id")]
    InvalidStripeCustomerId,
    /// The user does not have a default payment
    #[error("No default payment")]
    NoDefaultPayment,
    /// Failed to get the user's context
    #[error("Failed to get user context")]
    UserContextErr,
    /// Failed to get the data from the storage layer.
    /// This could be the stripe client or macrodb.
    #[error("Failed to get stripe subscription")]
    StorageLayerError(#[from] anyhow::Error),
}

impl IntoResponse for StripeCustomerError {
    fn into_response(self) -> Response {
        let err = Json(ErrorResponse {
            message: &self.to_string(),
        });
        match self {
            StripeCustomerError::NoStripeCustomerId => (StatusCode::UNAUTHORIZED, err),
            StripeCustomerError::NoDefaultPayment => (StatusCode::UNAUTHORIZED, err),
            StripeCustomerError::InvalidStripeCustomerId => {
                (StatusCode::INTERNAL_SERVER_ERROR, err)
            }
            StripeCustomerError::UserContextErr => (StatusCode::INTERNAL_SERVER_ERROR, err),
            StripeCustomerError::StorageLayerError(_error) => {
                (StatusCode::INTERNAL_SERVER_ERROR, err)
            }
        }
        .into_response()
    }
}

#[async_trait]
impl<S> FromRequestParts<S> for StripeCustomerExtractor
where
    PgPool: FromRef<S>,
    Arc<stripe::Client>: FromRef<S>,
    S: Send + Sync + Clone + 'static,
{
    type Rejection = StripeCustomerError;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let db = PgPool::from_ref(state);
        let stripe_client: Arc<stripe::Client> = Arc::from_ref(state);

        let Extension(UserContext { user_id, .. }) = parts
            .extract()
            .await
            .map_err(|_| StripeCustomerError::UserContextErr)?;

        let user_id = MacroUserId::parse_from_str(&user_id)
            .map_err(|_| StripeCustomerError::UserContextErr)?
            .lowercase();

        let stripe_customer_id =
            macro_db_client::user::get::get_stripe_customer_id_by_user_id(&db, &user_id)
                .await
                .map_err(|e| match e {
                    sqlx::Error::RowNotFound => StripeCustomerError::UserContextErr,
                    _ => StripeCustomerError::StorageLayerError(anyhow::anyhow!(
                        "unable to get stripe customer id"
                    )),
                })?;

        let stripe_customer_id =
            stripe_customer_id.ok_or(StripeCustomerError::NoStripeCustomerId)?;

        let stripe_customer_id: stripe::CustomerId = stripe_customer_id
            .parse()
            .map_err(|_| StripeCustomerError::InvalidStripeCustomerId)?;

        let customer = stripe::Customer::retrieve(
            &stripe_client,
            &stripe_customer_id,
            &["invoice_settings.default_payment_method"],
        )
        .await
        .map_err(|_| {
            StripeCustomerError::StorageLayerError(anyhow::anyhow!(
                "unable to get stripe customer payment methods"
            ))
        })?;

        let default_pm_id = customer
            .invoice_settings
            .and_then(|settings| settings.default_payment_method)
            .map(|pm| match pm {
                stripe::Expandable::Id(id) => id,
                stripe::Expandable::Object(pm) => pm.id,
            })
            .ok_or(StripeCustomerError::NoDefaultPayment)?;

        Ok(Self {
            stripe_customer_id,
            default_pm_id,
        })
    }
}
