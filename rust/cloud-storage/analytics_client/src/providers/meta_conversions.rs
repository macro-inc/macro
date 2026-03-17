//! Meta (Facebook) Conversions API provider.

use super::AnalyticsProvider;
use crate::AnalyticsError;
use sha2::{Digest, Sha256};

/// Meta Conversions API provider.
#[derive(Clone, Debug)]
pub struct MetaConversionsProvider {
    client: reqwest::Client,
    pixel_id: String,
    access_token: String,
    test_event_code: Option<String>,
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

fn hash_sha256(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.to_lowercase().trim().as_bytes());
    hex::encode(hasher.finalize())
}

#[async_trait::async_trait]
impl AnalyticsProvider for MetaConversionsProvider {
    async fn track(
        &self,
        distinct_id: &str,
        event_name: &str,
        properties: serde_json::Value,
    ) -> Result<(), AnalyticsError> {
        let url = format!(
            "https://graph.facebook.com/v18.0/{}/events",
            self.pixel_id
        );

        let event_time = chrono::Utc::now().timestamp();

        // Build user_data from distinct_id (email)
        let user_data = serde_json::json!({
            "em": [hash_sha256(distinct_id)]
        });

        // Get event_id from transaction_id if present
        let event_id = properties
            .get("transaction_id")
            .and_then(|v| v.as_str())
            .map(|id| format!("{}_{}", id, event_time));

        let mut event = serde_json::json!({
            "event_name": event_name,
            "event_time": event_time,
            "action_source": "website",
            "user_data": user_data,
            "custom_data": properties,
        });

        if let Some(id) = event_id {
            event["event_id"] = serde_json::json!(id);
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
        _distinct_id: &str,
        _properties: serde_json::Value,
    ) -> Result<(), AnalyticsError> {
        // Meta doesn't have identify - user data is sent with each event
        Ok(())
    }
}
