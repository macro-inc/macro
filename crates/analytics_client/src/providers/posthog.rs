//! PostHog analytics provider.

use serde::Serialize;

/// PostHog analytics provider for server-side event tracking.
#[derive(Clone)]
pub struct PostHogProvider {
    client: reqwest::Client,
    api_key: String,
    host: String,
}

impl PostHogProvider {
    /// Creates a new PostHog provider.
    ///
    /// - `api_key`: PostHog project API key
    /// - `host`: PostHog host
    pub fn new(api_key: String, host: String) -> Self {
        Self {
            client: reqwest::Client::new(),
            api_key,
            host,
        }
    }

    /// Captures an event to PostHog.
    ///
    /// - `distinct_id`: Unique identifier for the user (e.g., email or user ID)
    /// - `event_name`: Name of the event (e.g., "subscription_created")
    /// - `properties`: Additional event properties
    #[tracing::instrument(skip(self, properties), err)]
    pub async fn capture(
        &self,
        distinct_id: &str,
        event_name: &str,
        properties: impl Serialize,
    ) -> Result<(), reqwest::Error> {
        let url = format!("{}/i/v0/e/", self.host.trim_end_matches('/'));

        let properties = serde_json::to_value(properties).unwrap_or_default();

        let payload = serde_json::json!({
            "api_key": self.api_key,
            "event": event_name,
            "distinct_id": distinct_id,
            "properties": properties,
        });

        self.client
            .post(&url)
            .json(&payload)
            .send()
            .await?
            .error_for_status()?;

        Ok(())
    }
}
