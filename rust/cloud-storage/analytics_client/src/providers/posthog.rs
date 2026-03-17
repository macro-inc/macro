//! PostHog analytics provider.

use super::AnalyticsProvider;
use crate::AnalyticsError;

/// PostHog analytics provider.
#[derive(Clone, Debug)]
pub struct PostHogProvider {
    client: reqwest::Client,
    api_key: String,
    host: String,
}

impl PostHogProvider {
    /// Creates a new PostHog provider with a custom host.
    pub fn new(api_key: String, host: String) -> Self {
        Self {
            client: reqwest::Client::new(),
            api_key,
            host,
        }
    }

    /// Creates a new PostHog provider using the cloud host.
    pub fn new_cloud(api_key: String) -> Self {
        Self::new(api_key, "https://app.posthog.com".to_string())
    }
}

#[async_trait::async_trait]
impl AnalyticsProvider for PostHogProvider {
    async fn track(
        &self,
        distinct_id: &str,
        event_name: &str,
        properties: serde_json::Value,
    ) -> Result<(), AnalyticsError> {
        let url = format!("{}/capture/", self.host);

        let payload = serde_json::json!({
            "api_key": self.api_key,
            "event": event_name,
            "distinct_id": distinct_id,
            "properties": properties,
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
        let url = format!("{}/capture/", self.host);

        let payload = serde_json::json!({
            "api_key": self.api_key,
            "event": "$identify",
            "distinct_id": distinct_id,
            "$set": properties,
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
