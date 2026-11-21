//! Tells agent_harness_service that a machine's teammate installs changed
//! (`POST /internal/teammates/{harness}/changed`), so the replica holding its
//! macrod socket delivers or stops them now. Best effort: a machine that
//! misses it catches up when it next connects.

use std::time::Duration;

use macro_authorization::INTERNAL_API_KEY_HEADER;
use reqwest::header::HeaderValue;
use team_agents::domain::models::HarnessId;
use team_agents::domain::ports::TeammateRuntimes;

/// The internal route, with the fleet-wide internal key.
pub struct HarnessTeammateRuntimes {
    http: reqwest::Client,
    harness_url: String,
    key: HeaderValue,
}

impl HarnessTeammateRuntimes {
    /// Call `harness_url` with the fleet-wide internal key.
    pub fn new(harness_url: String, internal_key: &str) -> anyhow::Result<Self> {
        let mut key = HeaderValue::from_str(internal_key)?;
        key.set_sensitive(true);
        Ok(Self {
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(10))
                .redirect(reqwest::redirect::Policy::none())
                .build()?,
            harness_url,
            key,
        })
    }
}

impl TeammateRuntimes for HarnessTeammateRuntimes {
    #[tracing::instrument(name = "teammate.installs_changed", skip(self))]
    async fn installs_changed(&self, harness: HarnessId) {
        let mut headers = reqwest::header::HeaderMap::new();
        macro_tower_layers::inject_trace_headers(&mut headers);
        let sent = self
            .http
            .post(format!(
                "{}/internal/teammates/{harness}/changed",
                self.harness_url.trim_end_matches('/')
            ))
            .headers(headers)
            .header(INTERNAL_API_KEY_HEADER, self.key.clone())
            .send()
            .await
            .and_then(reqwest::Response::error_for_status);
        if let Err(error) = sent {
            tracing::warn!(error = %error, "could not tell the machine's service; it catches up when the machine next connects");
        }
    }
}
