//! PostHog analytics provider.

use super::AnalyticsProvider;
use crate::AnalyticsError;
use std::collections::HashMap;

/// PostHog analytics provider.
#[derive(Clone, Debug)]
pub struct PostHogProvider {
    client: reqwest::Client,
    api_key: String,
    host: String,
}

impl PostHogProvider {
    /// Creates a new PostHog provider.
    ///
    /// # Arguments
    /// * `api_key` - Your PostHog project API key
    /// * `host` - The PostHog host URL (e.g., "https://app.posthog.com" or your self-hosted instance)
    pub fn new(api_key: String, host: String) -> Self {
        Self {
            client: reqwest::Client::new(),
            api_key,
            host,
        }
    }

    /// Creates a new PostHog provider with the default cloud host.
    pub fn new_cloud(api_key: String) -> Self {
        Self::new(api_key, "https://app.posthog.com".to_string())
    }

    /// Creates a new PostHog provider for EU cloud.
    pub fn new_eu_cloud(api_key: String) -> Self {
        Self::new(api_key, "https://eu.posthog.com".to_string())
    }
}

#[async_trait::async_trait]
impl AnalyticsProvider for PostHogProvider {
    #[tracing::instrument(skip(self, properties), err)]
    async fn track(
        &self,
        distinct_id: &str,
        event_name: &str,
        properties: HashMap<String, serde_json::Value>,
    ) -> Result<(), AnalyticsError> {
        let mut payload_properties = properties;
        payload_properties.insert(
            "distinct_id".to_string(),
            serde_json::Value::String(distinct_id.to_string()),
        );

        let payload = serde_json::json!({
            "api_key": self.api_key,
            "event": event_name,
            "properties": payload_properties,
            "timestamp": chrono::Utc::now().to_rfc3339(),
        });

        let response = self
            .client
            .post(format!("{}/capture/", self.host))
            .header("Content-Type", "application/json")
            .json(&payload)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status().as_u16();
            let message = response.text().await.unwrap_or_default();
            return Err(AnalyticsError::ProviderError { status, message });
        }

        tracing::debug!(distinct_id, event_name, "PostHog track event sent");
        Ok(())
    }

    #[tracing::instrument(skip(self, properties), err)]
    async fn identify(
        &self,
        distinct_id: &str,
        properties: HashMap<String, serde_json::Value>,
    ) -> Result<(), AnalyticsError> {
        let payload = serde_json::json!({
            "api_key": self.api_key,
            "event": "$identify",
            "properties": {
                "distinct_id": distinct_id,
                "$set": properties,
            },
            "timestamp": chrono::Utc::now().to_rfc3339(),
        });

        let response = self
            .client
            .post(format!("{}/capture/", self.host))
            .header("Content-Type", "application/json")
            .json(&payload)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status().as_u16();
            let message = response.text().await.unwrap_or_default();
            return Err(AnalyticsError::ProviderError { status, message });
        }

        tracing::debug!(distinct_id, "PostHog identify sent");
        Ok(())
    }
}
