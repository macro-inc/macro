//! Meta (Facebook) Conversions API provider.

use serde::Serialize;
use sha2::{Digest, Sha256};

/// Action source for Meta Conversions API events.
#[derive(Clone, Debug, Default)]
pub enum MetaActionSource {
    /// Conversion happened on a website
    #[default]
    Website,
    /// Conversion happened in a mobile app
    App,
}

impl MetaActionSource {
    fn as_str(&self) -> &'static str {
        match self {
            MetaActionSource::Website => "website",
            MetaActionSource::App => "app",
        }
    }
}

/// User data for Meta Conversions API.
/// Email is automatically hashed (SHA256) before sending.
#[derive(Clone, Debug, Default)]
pub struct MetaUserData {
    /// User email (will be normalized and hashed)
    pub email: Option<String>,
    /// Facebook click ID from URL parameter `fbclid`
    pub fbc: Option<String>,
    /// Facebook browser ID from `_fbp` cookie
    pub fbp: Option<String>,
}

impl MetaUserData {
    /// Creates user data with an email.
    pub fn with_email(email: impl Into<String>) -> Self {
        Self {
            email: Some(email.into()),
            ..Default::default()
        }
    }

    fn to_json(&self) -> serde_json::Value {
        let mut data = serde_json::Map::new();

        if let Some(ref email) = self.email {
            data.insert("em".to_string(), serde_json::json!([hash_sha256(email)]));
        }
        if let Some(ref fbc) = self.fbc {
            data.insert("fbc".to_string(), serde_json::json!(fbc));
        }
        if let Some(ref fbp) = self.fbp {
            data.insert("fbp".to_string(), serde_json::json!(fbp));
        }

        serde_json::Value::Object(data)
    }
}

fn hash_sha256(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.to_lowercase().trim().as_bytes());
    hex::encode(hasher.finalize())
}

/// Meta provider for server-side event tracking.
#[derive(Clone)]
pub struct MetaProvider {
    client: reqwest::Client,
    pixel_id: String,
    access_token: String,
    test_event_code: Option<String>,
}

impl MetaProvider {
    /// Creates a new Meta provider.
    pub fn new(pixel_id: String, access_token: String, test_event_code: Option<String>) -> Self {
        Self {
            client: reqwest::Client::new(),
            pixel_id,
            access_token,
            test_event_code,
        }
    }

    /// Tracks an event to Meta Conversions API.
    ///
    /// - `event_name`: Standard event name (e.g., "Purchase", "Lead") or custom event
    /// - `user_data`: User identification data for matching
    /// - `action_source`: Where the conversion originated
    /// - `event_id`: Optional deduplication ID (recommended for server events)
    /// - `custom_data`: Additional event data (will be serialized to JSON)
    #[tracing::instrument(skip(self, user_data, custom_data), err)]
    pub async fn track(
        &self,
        event_name: &str,
        user_data: &MetaUserData,
        action_source: MetaActionSource,
        event_id: Option<&str>,
        custom_data: impl Serialize,
    ) -> Result<(), reqwest::Error> {
        let url = format!("https://graph.facebook.com/v18.0/{}/events", self.pixel_id);

        let event_time = chrono::Utc::now().timestamp();
        let custom_data = serde_json::to_value(custom_data).unwrap_or_default();

        let mut event = serde_json::json!({
            "event_name": event_name,
            "event_time": event_time,
            "action_source": action_source.as_str(),
            "user_data": user_data.to_json(),
            "custom_data": custom_data,
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

        self.client
            .post(&url)
            .json(&payload)
            .send()
            .await?
            .error_for_status()?;

        Ok(())
    }
}
