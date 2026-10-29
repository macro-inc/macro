//! PostHog analytics provider.

#[cfg(test)]
mod test;

use std::time::Duration;

use serde::Serialize;

/// Longest a capture may take. Analytics run beside product requests, so a
/// slow PostHog must not hold sockets or tasks open.
const CAPTURE_TIMEOUT: Duration = Duration::from_secs(5);

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
    #[tracing::instrument(skip(self, distinct_id, properties), err)]
    pub async fn capture(
        &self,
        distinct_id: &str,
        event_name: &str,
        properties: impl Serialize,
    ) -> Result<(), reqwest::Error> {
        let url = format!("{}/i/v0/e/", self.host.trim_end_matches('/'));

        self.client
            .post(&url)
            .timeout(CAPTURE_TIMEOUT)
            .json(&capture_payload(
                &self.api_key,
                distinct_id,
                event_name,
                properties,
            ))
            .send()
            .await?
            .error_for_status()?;

        Ok(())
    }
}

/// The capture request body. Server events never carry the user's IP, so
/// GeoIP is off: otherwise PostHog would place every user at the server and
/// overwrite their person location.
fn capture_payload(
    api_key: &str,
    distinct_id: &str,
    event_name: &str,
    properties: impl Serialize,
) -> serde_json::Value {
    let mut properties = match serde_json::to_value(properties) {
        Ok(serde_json::Value::Object(properties)) => properties,
        _ => serde_json::Map::new(),
    };
    properties.insert("$geoip_disable".to_owned(), true.into());

    serde_json::json!({
        "api_key": api_key,
        "event": event_name,
        "distinct_id": distinct_id,
        "properties": properties,
    })
}
