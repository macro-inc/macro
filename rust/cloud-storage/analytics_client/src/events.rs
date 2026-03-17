//! Shared analytics event types.

use serde::Serialize;

/// A purchase/conversion event.
#[derive(Debug, Clone, Serialize)]
pub struct PurchaseEvent {
    /// Transaction/order ID for deduplication
    pub transaction_id: String,
    /// Value in dollars
    pub value: f64,
    /// ISO 4217 currency code (e.g., "USD")
    pub currency: String,
    /// Optional content name (e.g., "subscription", "team_subscription")
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_name: Option<String>,
}

/// A refund/cancellation event.
#[derive(Debug, Clone, Serialize)]
pub struct RefundEvent {
    /// Transaction/order ID
    pub transaction_id: String,
    /// Value in dollars (optional)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<f64>,
    /// ISO 4217 currency code
    #[serde(skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
}
