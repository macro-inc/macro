//! Google Analytics 4 Measurement Protocol provider.

use super::AnalyticsProvider;
use crate::AnalyticsError;

/// Google Analytics 4 Measurement Protocol provider.
#[derive(Clone, Debug)]
pub struct GoogleAnalyticsProvider {
    client: reqwest::Client,
    measurement_id: String,
    api_secret: String,
}

impl GoogleAnalyticsProvider {
    /// Creates a new Google Analytics provider.
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
    async fn track(
        &self,
        distinct_id: &str,
        event_name: &str,
        properties: serde_json::Value,
    ) -> Result<(), AnalyticsError> {
        let url = format!(
            "https://www.google-analytics.com/mp/collect?measurement_id={}&api_secret={}",
            self.measurement_id, self.api_secret
        );

        let payload = serde_json::json!({
            "client_id": distinct_id,
            "user_id": distinct_id,
            "events": [{
                "name": event_name,
                "params": properties,
            }],
        });

        let response = self
            .client
            .post(&url)
            .json(&payload)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status().as_u16();
            let message = response.text().await.unwrap_or_default();
            return Err(AnalyticsError::ProviderError { status, message });
        }

        Ok(())
    }

    async fn identify(
        &self,
        distinct_id: &str,
        properties: serde_json::Value,
    ) -> Result<(), AnalyticsError> {
        let url = format!(
            "https://www.google-analytics.com/mp/collect?measurement_id={}&api_secret={}",
            self.measurement_id, self.api_secret
        );

        // Convert to GA4 user_properties format
        let user_properties = if let Some(obj) = properties.as_object() {
            obj.iter()
                .map(|(k, v)| (k.clone(), serde_json::json!({ "value": v })))
                .collect::<serde_json::Map<_, _>>()
        } else {
            serde_json::Map::new()
        };

        let payload = serde_json::json!({
            "client_id": distinct_id,
            "user_id": distinct_id,
            "user_properties": user_properties,
            "events": [{ "name": "user_identify", "params": {} }],
        });

        let response = self
            .client
            .post(&url)
            .json(&payload)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status().as_u16();
            let message = response.text().await.unwrap_or_default();
            return Err(AnalyticsError::ProviderError { status, message });
        }

        Ok(())
    }
}
