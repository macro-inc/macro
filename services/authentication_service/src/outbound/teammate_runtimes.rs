//! Tells agent_harness_service that a machine's teammate installs changed
//! (`POST /internal/teammates/{harness}/changed`), so the replica holding its
//! macrod socket delivers or stops them now, or that its owner asked it to
//! check its hosting again (`.../recheck`). Best effort: a machine that
//! misses a change catches up when it next connects, and a missed recheck
//! is its own next check.

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
    #[tracing::instrument(name = "teammate.recheck_host", skip(self))]
    async fn recheck_host(&self, harness: HarnessId) {
        self.post(harness, "recheck").await;
    }

    #[tracing::instrument(name = "teammate.installs_changed", skip(self))]
    async fn installs_changed(&self, harness: HarnessId) {
        self.post(harness, "changed").await;
    }
}

impl HarnessTeammateRuntimes {
    /// `POST /internal/teammates/{harness}/{action}`; a failure is logged
    /// on the caller's span.
    async fn post(&self, harness: HarnessId, action: &str) {
        let mut headers = reqwest::header::HeaderMap::new();
        macro_tower_layers::inject_trace_headers(&mut headers);
        let sent = self
            .http
            .post(format!(
                "{}/internal/teammates/{harness}/{action}",
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

macro_env_var::maybe_env_vars! {
    /// A local stack's x86-64 teammate runtime image,
    /// `<repository>@sha256:<hex>`; ignored outside `ENVIRONMENT=local`.
    struct OverrideTeammateRuntimeImageAmd64;
    /// The same for arm64.
    struct OverrideTeammateRuntimeImageArm64;
}

/// The teammate runtime images, with a local stack's overrides read once,
/// at startup.
pub(crate) fn teammate_runtime_images() -> team_agents::domain::self_hosting::RuntimeImages {
    use team_agents::domain::self_hosting::{LocalImages, TeammateRuntimeImage};
    let amd64 = OverrideTeammateRuntimeImageAmd64::new().map(|value| value.to_string());
    let arm64 = OverrideTeammateRuntimeImageArm64::new().map(|value| value.to_string());
    let overrides = LocalImages::read(macro_env::Environment::new_or_prod(), |name| {
        if name == TeammateRuntimeImage::OVERRIDE_AMD64 {
            amd64.clone()
        } else if name == TeammateRuntimeImage::OVERRIDE_ARM64 {
            arm64.clone()
        } else {
            None
        }
    });
    TeammateRuntimeImage::images(overrides)
}
