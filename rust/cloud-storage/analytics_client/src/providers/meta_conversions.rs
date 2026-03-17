//! Meta (Facebook) Conversions API provider.
//!
//! This provider sends events to Meta's Conversions API for conversion tracking.
//! See: <https://developers.facebook.com/docs/marketing-api/conversions-api>
//!
//! Use the type-safe event structs ([`MetaPurchaseEvent`], [`MetaCancelSubscriptionEvent`], etc.)
//! to ensure all required fields are provided.

use super::AnalyticsProvider;
use crate::error::AnalyticsError;
use crate::events::AnalyticsEvent;
use sha2::{Digest, Sha256};
use std::collections::HashMap;

/// Meta Conversions API provider.
#[derive(Clone, Debug)]
pub struct MetaConversionsProvider {
    client: reqwest::Client,
    pixel_id: String,
    access_token: String,
    test_event_code: Option<String>,
}

/// A purchase event for Meta Conversions API.
///
/// Use this for subscription creation, one-time purchases, etc.
#[derive(Clone, Debug)]
pub struct MetaPurchaseEvent {
    /// Purchase value in dollars (required)
    pub value: f64,
    /// ISO 4217 currency code e.g. "USD" (required)
    pub currency: String,
    /// Order/subscription ID for deduplication
    pub order_id: Option<String>,
    /// Content name (e.g., "subscription", "pro_plan")
    pub content_name: Option<String>,
}

impl AnalyticsEvent for MetaPurchaseEvent {
    fn into_properties(self) -> HashMap<String, serde_json::Value> {
        let mut props = HashMap::new();
        props.insert("value".to_string(), serde_json::json!(self.value));
        props.insert(
            "currency".to_string(),
            serde_json::json!(self.currency.to_uppercase()),
        );
        props.insert("content_type".to_string(), serde_json::json!("product"));
        if let Some(order_id) = self.order_id {
            props.insert("order_id".to_string(), serde_json::json!(order_id));
        }
        if let Some(content_name) = self.content_name {
            props.insert("content_name".to_string(), serde_json::json!(content_name));
        }
        props
    }
}

/// A subscription cancellation event for Meta Conversions API.
#[derive(Clone, Debug)]
pub struct MetaCancelSubscriptionEvent {
    /// Subscription ID for deduplication (required)
    pub subscription_id: String,
    /// Original subscription value in dollars (optional, for LTV tracking)
    pub value: Option<f64>,
    /// ISO 4217 currency code
    pub currency: Option<String>,
}

impl AnalyticsEvent for MetaCancelSubscriptionEvent {
    fn into_properties(self) -> HashMap<String, serde_json::Value> {
        let mut props = HashMap::new();
        props.insert(
            "subscription_id".to_string(),
            serde_json::json!(self.subscription_id),
        );
        if let Some(value) = self.value {
            props.insert("value".to_string(), serde_json::json!(value));
        }
        if let Some(currency) = self.currency {
            props.insert(
                "currency".to_string(),
                serde_json::json!(currency.to_uppercase()),
            );
        }
        props
    }
}

/// A lead event for Meta Conversions API.
#[derive(Clone, Debug)]
pub struct MetaLeadEvent {
    /// Lead value if known
    pub value: Option<f64>,
    /// ISO 4217 currency code
    pub currency: Option<String>,
    /// Lead type/category
    pub lead_type: Option<String>,
}

impl AnalyticsEvent for MetaLeadEvent {
    fn into_properties(self) -> HashMap<String, serde_json::Value> {
        let mut props = HashMap::new();
        if let Some(value) = self.value {
            props.insert("value".to_string(), serde_json::json!(value));
        }
        if let Some(currency) = self.currency {
            props.insert(
                "currency".to_string(),
                serde_json::json!(currency.to_uppercase()),
            );
        }
        if let Some(lead_type) = self.lead_type {
            props.insert("lead_type".to_string(), serde_json::json!(lead_type));
        }
        props
    }
}

/// Hashes a value using SHA256 as required by Meta Conversions API.
fn hash_value(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.to_lowercase().trim().as_bytes());
    hex::encode(hasher.finalize())
}

impl MetaConversionsProvider {
    /// Creates a new Meta Conversions API provider.
    pub fn new(pixel_id: String, access_token: String) -> Self {
        Self {
            client: reqwest::Client::new(),
            pixel_id,
            access_token,
            test_event_code: None,
        }
    }

    /// Sets a test event code for testing in Meta Events Manager.
    pub fn with_test_event_code(mut self, code: String) -> Self {
        self.test_event_code = Some(code);
        self
    }
}

#[async_trait::async_trait]
impl AnalyticsProvider for MetaConversionsProvider {
    #[tracing::instrument(skip(self, properties), err)]
    async fn track(
        &self,
        distinct_id: &str,
        event_name: &str,
        properties: HashMap<String, serde_json::Value>,
    ) -> Result<(), AnalyticsError> {
        let url = format!(
            "https://graph.facebook.com/v18.0/{}/events",
            self.pixel_id
        );

        let event_time = chrono::Utc::now().timestamp();

        // Build user_data from distinct_id (assumed to be email)
        let user_data = serde_json::json!({
            "em": [hash_value(distinct_id)]
        });

        // Use properties as custom_data
        let custom_data: serde_json::Map<String, serde_json::Value> = properties.into_iter().collect();

        let mut event = serde_json::json!({
            "event_name": event_name,
            "event_time": event_time,
            "action_source": "website",
            "user_data": user_data,
            "custom_data": custom_data,
        });

        // Use order_id or subscription_id as event_id for deduplication if present
        if let Some(id) = custom_data.get("order_id").or(custom_data.get("subscription_id")) {
            if let Some(id_str) = id.as_str() {
                event["event_id"] = serde_json::json!(format!("{}_{}", id_str, event_time));
            }
        }

        let mut payload = serde_json::json!({
            "data": [event],
            "access_token": self.access_token,
        });

        if let Some(ref test_code) = self.test_event_code {
            payload["test_event_code"] = serde_json::json!(test_code);
        }

        let response = self
            .client
            .post(&url)
            .header("Content-Type", "application/json")
            .json(&payload)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status().as_u16();
            let message = response.text().await.unwrap_or_default();
            return Err(AnalyticsError::ProviderError { status, message });
        }

        tracing::debug!(event_name, "Meta Conversions API event sent");
        Ok(())
    }

    #[tracing::instrument(skip(self, _properties), err)]
    async fn identify(
        &self,
        distinct_id: &str,
        _properties: HashMap<String, serde_json::Value>,
    ) -> Result<(), AnalyticsError> {
        // Meta Conversions API doesn't have a direct identify concept.
        // User data is sent with each event.
        tracing::debug!(
            distinct_id,
            "Meta Conversions API: identify is no-op (user data sent with events)"
        );
        Ok(())
    }
}
