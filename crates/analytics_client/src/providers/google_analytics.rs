//! Google Analytics 4 Measurement Protocol provider.

use serde::Serialize;

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

    /// Tracks an event to GA4.
    #[tracing::instrument(skip(self, params), err)]
    pub async fn track(
        &self,
        client_id: &str,
        event_name: &str,
        params: impl Serialize,
    ) -> Result<(), reqwest::Error> {
        let url = format!(
            "https://www.google-analytics.com/mp/collect?measurement_id={}&api_secret={}",
            self.measurement_id, self.api_secret
        );

        let params = serde_json::to_value(params).unwrap_or_default();

        let payload = serde_json::json!({
            "client_id": client_id,
            "events": [{
                "name": event_name,
                "params": params,
            }],
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
