//! Google Analytics 4 Measurement Protocol provider.
//!
//! This provider sends events to GA4 using the Measurement Protocol.
//! See: <https://developers.google.com/analytics/devguides/collection/protocol/ga4>

use super::AnalyticsProvider;
use crate::events::AnalyticsEvent;
use crate::AnalyticsError;
use std::collections::HashMap;

/// Google Analytics 4 Measurement Protocol provider.
///
/// Sends events to GA4 for conversion tracking and attribution.
#[derive(Clone, Debug)]
pub struct GoogleAnalyticsProvider {
    client: reqwest::Client,
    measurement_id: String,
    api_secret: String,
}

/// A purchase event for Google Analytics (GA4).
///
/// Maps to GA4's recommended `purchase` event.
/// See: <https://developers.google.com/analytics/devguides/collection/ga4/reference/events#purchase>
#[derive(Clone, Debug)]
pub struct GaPurchaseEvent {
    /// Transaction ID (e.g., subscription ID)
    pub transaction_id: String,
    /// Purchase value in dollars (required)
    pub value: f64,
    /// ISO 4217 currency code e.g. "USD" (required)
    pub currency: String,
}

impl AnalyticsEvent for GaPurchaseEvent {
    fn into_properties(self) -> HashMap<String, serde_json::Value> {
        let mut props = HashMap::new();
        props.insert(
            "transaction_id".to_string(),
            serde_json::json!(self.transaction_id),
        );
        props.insert("value".to_string(), serde_json::json!(self.value));
        props.insert(
            "currency".to_string(),
            serde_json::json!(self.currency.to_uppercase()),
        );
        props
    }
}

/// A refund event for Google Analytics (GA4).
///
/// Maps to GA4's recommended `refund` event.
/// See: <https://developers.google.com/analytics/devguides/collection/ga4/reference/events#refund>
#[derive(Clone, Debug)]
pub struct GaRefundEvent {
    /// Transaction ID (e.g., subscription ID)
    pub transaction_id: String,
    /// Refund value in dollars (optional)
    pub value: Option<f64>,
    /// ISO 4217 currency code
    pub currency: Option<String>,
}

impl AnalyticsEvent for GaRefundEvent {
    fn into_properties(self) -> HashMap<String, serde_json::Value> {
        let mut props = HashMap::new();
        props.insert(
            "transaction_id".to_string(),
            serde_json::json!(self.transaction_id),
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

impl GoogleAnalyticsProvider {
    /// Creates a new Google Analytics provider.
    ///
    /// # Arguments
    /// * `measurement_id` - Your GA4 Measurement ID (e.g., "G-XXXXXXXXXX")
    /// * `api_secret` - Your Measurement Protocol API secret
    pub fn new(measurement_id: String, api_secret: String) -> Self {
        Self {
            client: reqwest::Client::new(),
            measurement_id,
            api_secret,
        }
    }
}

#[async_trait::async_trait]
impl AnalyticsProvider for GoogleAnalyticsProvider {
    #[tracing::instrument(skip(self, properties), err)]
    async fn track(
        &self,
        distinct_id: &str,
        event_name: &str,
        properties: HashMap<String, serde_json::Value>,
    ) -> Result<(), AnalyticsError> {
        let url = format!(
            "https://www.google-analytics.com/mp/collect?measurement_id={}&api_secret={}",
            self.measurement_id, self.api_secret
        );

        // Use properties directly as event params
        let params: serde_json::Map<String, serde_json::Value> = properties.into_iter().collect();

        let payload = serde_json::json!({
            "client_id": distinct_id,
            "user_id": distinct_id,
            "events": [{
                "name": event_name,
                "params": params,
            }],
        });

        let response = self
            .client
            .post(&url)
            .header("Content-Type", "application/json")
            .json(&payload)
            .send()
            .await?;

        // GA4 Measurement Protocol returns 2xx even for invalid events,
        // but we should still check for transport errors
        if !response.status().is_success() {
            let status = response.status().as_u16();
            let message = response.text().await.unwrap_or_default();
            return Err(AnalyticsError::ProviderError { status, message });
        }

        tracing::debug!(distinct_id, event_name, "GA4 track event sent");
        Ok(())
    }

    #[tracing::instrument(skip(self, properties), err)]
    async fn identify(
        &self,
        distinct_id: &str,
        properties: HashMap<String, serde_json::Value>,
    ) -> Result<(), AnalyticsError> {
        let url = format!(
            "https://www.google-analytics.com/mp/collect?measurement_id={}&api_secret={}",
            self.measurement_id, self.api_secret
        );

        // Convert properties to GA4 user_properties format
        let mut user_properties = serde_json::Map::new();
        for (key, value) in properties {
            user_properties.insert(key, serde_json::json!({ "value": value }));
        }

        let payload = serde_json::json!({
            "client_id": distinct_id,
            "user_id": distinct_id,
            "user_properties": user_properties,
            "events": [{
                "name": "user_identify",
                "params": {},
            }],
        });

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

        tracing::debug!(distinct_id, "GA4 identify sent");
        Ok(())
    }
}
