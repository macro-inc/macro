//! Tells the authentication service a machine was unpaired, so the agent
//! teammates it hosted are parked at once rather than at its next 60 s sweep.

use std::time::Duration;

use harnesses::domain::retired::{HarnessId, HarnessRetired, RetiredFuture};

/// How long an unpair waits on the authentication service; the sweep covers
/// a slow or failed call.
const TIMEOUT: Duration = Duration::from_secs(10);

/// [`HarnessRetired`] over the authentication service's internal
/// `POST /internal/teammate_hosts/offboard`.
#[derive(Clone)]
pub struct TeammateHostOffboarding {
    http: reqwest::Client,
    url: String,
    internal_key: String,
}

impl std::fmt::Debug for TeammateHostOffboarding {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("TeammateHostOffboarding")
    }
}

impl TeammateHostOffboarding {
    /// Call the authentication service at `auth_service_url` with its
    /// internal key.
    pub fn new(auth_service_url: &str, internal_key: String) -> anyhow::Result<Self> {
        Ok(Self {
            http: reqwest::Client::builder()
                .timeout(TIMEOUT)
                .redirect(reqwest::redirect::Policy::none())
                .build()?,
            url: format!(
                "{}/internal/teammate_hosts/offboard",
                auth_service_url.trim_end_matches('/')
            ),
            internal_key,
        })
    }
}

impl HarnessRetired for TeammateHostOffboarding {
    fn harness_retired(&self, harness_id: HarnessId) -> RetiredFuture<'_> {
        Box::pin(tracing::Instrument::instrument(
            async move {
                let mut headers = reqwest::header::HeaderMap::new();
                macro_tower_layers::inject_trace_headers(&mut headers);
                let response = self
                    .http
                    .post(&self.url)
                    .headers(headers)
                    .header(
                        macro_authorization::INTERNAL_API_KEY_HEADER,
                        &self.internal_key,
                    )
                    .send()
                    .await?;
                anyhow::ensure!(
                    response.status() == reqwest::StatusCode::NO_CONTENT,
                    "the authentication service answered {}",
                    response.status()
                );
                Ok(())
            },
            tracing::info_span!("teammate_hosts.offboard_after_unpair", %harness_id),
        ))
    }
}
