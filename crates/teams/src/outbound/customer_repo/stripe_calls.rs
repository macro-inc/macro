//! A span per Stripe API call, and the in-process cache of catalog prices.

use std::future::Future;
use std::sync::Mutex;

use tracing::Instrument;

use super::*;

/// The span of one Stripe API call, named `stripe.<object>.<verb>` with the
/// object's id as a field; [`traced`] marks it as an error when the call
/// fails. Never record an idempotency key or a request body.
macro_rules! stripe_span {
    ($name:literal $(, $($field:tt)*)?) => {
        tracing::info_span!(
            $name,
            otel.kind = "client",
            otel.status_code = tracing::field::Empty,
            error.type = tracing::field::Empty,
            $($($field)*)?
        )
    };
}
pub(super) use stripe_span;

/// Run one Stripe call inside its [`stripe_span!`] span, marked as an
/// error when it fails.
pub(super) async fn traced<Answer>(
    span: tracing::Span,
    call: impl Future<Output = Result<Answer, stripe::StripeError>>,
) -> Result<Answer, stripe::StripeError> {
    let answer = call.instrument(span.clone()).await;
    if let Err(error) = &answer {
        span.record("otel.status_code", "ERROR");
        span.record("error.type", stripe_error_type(error));
    }
    answer
}

/// A short, content-free name for a Stripe failure.
fn stripe_error_type(error: &stripe::StripeError) -> &'static str {
    match error {
        stripe::StripeError::Stripe(request) => match request.http_status {
            402 => "payment_required",
            409 => "conflict",
            429 => "rate_limited",
            status if status >= 500 => "server_error",
            _ => "request_error",
        },
        stripe::StripeError::Timeout => "timeout",
        stripe::StripeError::ClientError(_) => "client_error",
        stripe::StripeError::QueryStringSerialize(_) | stripe::StripeError::JSONSerialize(_) => {
            "serialization_error"
        }
        stripe::StripeError::UnsupportedVersion => "unsupported_version",
    }
}

/// Catalog prices read from Stripe: their amount, currency and interval
/// never change once created, so each is read once per process. Whether a
/// price is still active can change (archived), so the cache is never used
/// to decide whether a price may be sold. Bounded, since any price id may
/// be asked for.
#[derive(Clone, Default)]
pub(super) struct CatalogPrices(Arc<Mutex<HashMap<stripe::PriceId, stripe::Price>>>);

/// Catalog prices kept per process; the catalog has a handful.
const MAX_CATALOG_PRICES: usize = 64;

impl CatalogPrices {
    fn get(&self, price_id: &stripe::PriceId) -> Option<stripe::Price> {
        self.0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(price_id)
            .cloned()
    }

    fn keep(&self, price: &stripe::Price) {
        let mut prices = self
            .0
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if prices.len() < MAX_CATALOG_PRICES {
            prices.insert(price.id.clone(), price.clone());
        }
    }
}

impl CustomerRepositoryImpl {
    /// A catalog price, from the cache or read once from Stripe.
    pub(super) async fn catalog_price(
        &self,
        price_id: &stripe::PriceId,
    ) -> Result<stripe::Price, CustomerError> {
        if let Some(price) = self.catalog_prices.get(price_id) {
            tracing::debug!(price_id = %price_id, "catalog price cached");
            return Ok(price);
        }
        let price = traced(
            stripe_span!("stripe.price.retrieve", price_id = %price_id),
            stripe::Price::retrieve(&self.client, price_id, &[]),
        )
        .await
        .map_err(storage)?;
        self.catalog_prices.keep(&price);
        Ok(price)
    }
}
