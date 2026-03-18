//! Shared analytics event types.

use serde::Serialize;

/// Event for when a Stripe subscription is created.
#[derive(Debug, Clone, Serialize)]
pub struct StripeSubscriptionCreatedEvent {
    /// Subscription ID for deduplication
    pub transaction_id: String,
    /// Value in dollars
    pub value: f64,
    /// ISO 4217 currency code (e.g., "USD")
    pub currency: String,
}

/// Event for when a Stripe subscription is cancelled.
#[derive(Debug, Clone, Serialize)]
pub struct StripeSubscriptionCancelledEvent {
    /// Subscription ID
    pub transaction_id: String,
    /// Value in dollars
    pub value: f64,
    /// ISO 4217 currency code
    pub currency: String,
}
