//! Analytics event types for subscription-related events.

use std::collections::HashMap;

/// Trait for analytics events that can be converted to properties.
///
/// Implement this trait to create custom analytics events that can be
/// passed to `AnalyticsClient::track()`.
pub trait AnalyticsEvent {
    /// Convert the event into a properties map for analytics tracking.
    fn into_properties(self) -> HashMap<String, serde_json::Value>;
}

/// Event emitted when a subscription is created.
#[derive(Debug, Clone)]
pub struct SubscriptionCreatedEvent {
    /// The Stripe subscription ID
    pub subscription_id: String,
    /// The subscription status (e.g., "active", "trialing")
    pub subscription_status: String,
    /// Whether this is a team subscription
    pub is_team_subscription: bool,
    /// The team ID if this is a team subscription
    pub team_id: Option<uuid::Uuid>,
    /// The subscription value in the smallest currency unit (e.g., cents for USD)
    pub value: Option<i64>,
    /// The three-letter ISO currency code (e.g., "usd")
    pub currency: Option<String>,
}

impl AnalyticsEvent for SubscriptionCreatedEvent {
    fn into_properties(self) -> HashMap<String, serde_json::Value> {
        let mut properties = HashMap::new();
        properties.insert(
            "subscription_id".to_string(),
            serde_json::Value::String(self.subscription_id),
        );
        properties.insert(
            "subscription_status".to_string(),
            serde_json::Value::String(self.subscription_status),
        );
        properties.insert(
            "is_team_subscription".to_string(),
            serde_json::Value::Bool(self.is_team_subscription),
        );
        if let Some(team_id) = self.team_id {
            properties.insert(
                "team_id".to_string(),
                serde_json::Value::String(team_id.to_string()),
            );
        }
        if let Some(value) = self.value {
            properties.insert("value".to_string(), serde_json::Value::Number(value.into()));
        }
        if let Some(currency) = self.currency {
            properties.insert("currency".to_string(), serde_json::Value::String(currency));
        }
        properties
    }
}

/// Event emitted when a subscription is cancelled.
#[derive(Debug, Clone)]
pub struct SubscriptionCancelledEvent {
    /// The Stripe subscription ID
    pub subscription_id: String,
    /// Whether this is a team subscription
    pub is_team_subscription: bool,
    /// The team ID if this is a team subscription
    pub team_id: Option<uuid::Uuid>,
    /// The subscription value in the smallest currency unit (e.g., cents for USD)
    pub value: Option<i64>,
    /// The three-letter ISO currency code (e.g., "usd")
    pub currency: Option<String>,
}

impl AnalyticsEvent for SubscriptionCancelledEvent {
    fn into_properties(self) -> HashMap<String, serde_json::Value> {
        let mut properties = HashMap::new();
        properties.insert(
            "subscription_id".to_string(),
            serde_json::Value::String(self.subscription_id),
        );
        properties.insert(
            "is_team_subscription".to_string(),
            serde_json::Value::Bool(self.is_team_subscription),
        );
        if let Some(team_id) = self.team_id {
            properties.insert(
                "team_id".to_string(),
                serde_json::Value::String(team_id.to_string()),
            );
        }
        if let Some(value) = self.value {
            properties.insert("value".to_string(), serde_json::Value::Number(value.into()));
        }
        if let Some(currency) = self.currency {
            properties.insert("currency".to_string(), serde_json::Value::String(currency));
        }
        properties
    }
}
