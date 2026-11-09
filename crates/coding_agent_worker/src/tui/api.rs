//! The TUI's read/act client against the harness APIs, as the harness.

use std::time::Duration;

use harnesses::domain::models::{Harness, HarnessAgent, HarnessSession};
use reqwest::StatusCode;
use rootcause::prelude::ResultExt as _;

use crate::config::Config;
use crate::config::HarnessCredentials;

const HARNESS_TOKEN_HEADER: &str = "x-macro-harness-token";

/// A dashboard read that takes longer than this is not worth waiting on: the
/// next refresh asks again.
const READ_TIMEOUT: Duration = Duration::from_secs(10);

/// What the server currently knows about this daemon.
#[derive(Debug, Clone, Default)]
pub struct Snapshot {
    /// The harness registration, when the credential still names a live one.
    pub harness: Option<Harness>,
    /// Agents bound to it.
    pub agents: Vec<HarnessAgent>,
    /// Recent sessions on those agents, newest first.
    pub sessions: Vec<HarnessSession>,
}

/// Client for the harness self endpoints.
pub struct HarnessSelfApi {
    http: reqwest::Client,
    base: String,
    token: String,
}

impl HarnessSelfApi {
    /// A client for the deployment the config names, with this credential,
    /// sending over `http`.
    pub fn new(config: &Config, credentials: &HarnessCredentials, http: reqwest::Client) -> Self {
        Self {
            http,
            base: config
                .macro_api
                .storage_url
                .trim_end_matches('/')
                .to_owned(),
            token: credentials.token.clone(),
        }
    }

    async fn read<T: serde::de::DeserializeOwned>(
        &self,
        what: &'static str,
        path: &str,
    ) -> rootcause::Result<Option<T>> {
        let response = self
            .http
            .get(format!("{}{path}", self.base))
            .header(HARNESS_TOKEN_HEADER, &self.token)
            .timeout(READ_TIMEOUT)
            .send()
            .await
            .map_err(|error| {
                rootcause::report!(
                    "could not reach the service to {what}: {}",
                    transport_failure(error)
                )
            })?;
        // A dead credential (revoked harness) answers 401; surface that as
        // "no harness" rather than an error so the UI offers re-pairing.
        if response.status() == StatusCode::UNAUTHORIZED
            || response.status() == StatusCode::NOT_FOUND
        {
            return Ok(None);
        }
        let status = response.status();
        if !status.is_success() {
            let message = response.text().await.unwrap_or_default();
            rootcause::bail!("the service answered {status} to {what}: {message}");
        }
        Ok(Some(response.json().await.context(format!(
            "could not read the service's answer to {what}"
        ))?))
    }

    /// Everything the dashboard shows, in one round of calls.
    pub async fn snapshot(&self) -> rootcause::Result<Snapshot> {
        let Some(harness) = self
            .read::<Harness>("identify the harness", "/harnesses/me")
            .await?
        else {
            return Ok(Snapshot::default());
        };
        let agents = self
            .read::<Vec<HarnessAgent>>("list bound agents", "/harnesses/me/agents")
            .await?
            .unwrap_or_default();
        let sessions = self
            .read::<Vec<HarnessSession>>("list sessions", "/harnesses/me/sessions")
            .await?
            .unwrap_or_default();
        Ok(Snapshot {
            harness: Some(harness),
            agents,
            sessions,
        })
    }

    /// Retire this harness: soft-delete it and revoke its credential.
    pub async fn delete_self(&self) -> rootcause::Result<()> {
        let response = self
            .http
            .delete(format!("{}/harnesses/me", self.base))
            .header(HARNESS_TOKEN_HEADER, &self.token)
            .send()
            .await
            .context("could not reach the service to remove the harness")?;
        let status = response.status();
        // Already gone counts as done: the goal is "this credential is dead".
        if !status.is_success()
            && status != StatusCode::NOT_FOUND
            && status != StatusCode::UNAUTHORIZED
        {
            let message = response.text().await.unwrap_or_default();
            rootcause::bail!("the service refused to remove the harness ({status}): {message}");
        }
        Ok(())
    }
}

/// A transport error with its causes on one line. reqwest's own message stops at
/// "error sending request for url", leaving out the reason, and the URL it leads
/// with would push the reason out of the one-line footer that shows this.
fn transport_failure(error: reqwest::Error) -> String {
    let error = error.without_url();
    let mut failure = error.to_string();
    let mut source = std::error::Error::source(&error);
    while let Some(cause) = source {
        failure.push_str(": ");
        failure.push_str(&cause.to_string());
        source = cause.source();
    }
    failure
}
