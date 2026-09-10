//! The daemon's half of device-code pairing: ask for a code, tell the user
//! where to approve it, poll until the credential is released.
//!
//! [`PairingClient`] speaks the HTTP protocol without printing anything; the
//! control panel drives it frame by frame.

use harnesses::domain::models::{
    ClaimPairingRequest, ClaimedPairing, CreatePairingRequest, CreatedPairing, HarnessOwner,
    RequestedHarnessScope,
};
use reqwest::StatusCode;
use rootcause::prelude::ResultExt as _;
use uuid::Uuid;

use crate::config::{Config, HarnessCredentials, HarnessScope};

/// One claim poll's answer.
#[derive(Debug)]
pub enum ClaimStatus {
    /// Not approved yet; poll again.
    Pending,
    /// Approved: the minted credential, released exactly once.
    Claimed(HarnessCredentials),
    /// The pairing can no longer be claimed (expired or already used).
    Gone(String),
}

/// The pairing protocol against one deployment, print-free.
pub struct PairingClient {
    http: reqwest::Client,
    base: String,
}

impl PairingClient {
    /// A client for the deployment the config names.
    pub fn new(config: &Config) -> Self {
        Self {
            http: reqwest::Client::new(),
            base: config
                .macro_api
                .storage_url
                .trim_end_matches('/')
                .to_owned(),
        }
    }

    /// Open a pairing using the config's identity.
    pub async fn start(&self, config: &Config) -> rootcause::Result<CreatedPairing> {
        let name = config
            .identity
            .name
            .clone()
            .or_else(local_hostname)
            .unwrap_or_else(|| "macrod".to_owned());
        let scope = match config.identity.scope {
            crate::config::IdentityScope::Private => RequestedHarnessScope::Private,
            crate::config::IdentityScope::Team => RequestedHarnessScope::Team,
        };

        let response = self
            .http
            .post(format!("{}/harness-pairings", self.base))
            .json(&CreatePairingRequest {
                name,
                host: Some(host_info()),
                scope: Some(scope),
            })
            .send()
            .await
            .context("could not reach the service to start pairing")?;
        if !response.status().is_success() {
            let status = response.status();
            let message = response.text().await.unwrap_or_default();
            rootcause::bail!("the service refused to start pairing ({status}): {message}");
        }
        Ok(response
            .json()
            .await
            .context("could not read the pairing the service created")?)
    }

    /// Poll the claim once.
    pub async fn claim(
        &self,
        pairing_id: Uuid,
        device_secret: &str,
    ) -> rootcause::Result<ClaimStatus> {
        let response = self
            .http
            .post(format!("{}/harness-pairings/{pairing_id}/claim", self.base))
            .json(&ClaimPairingRequest {
                device_secret: device_secret.to_owned(),
            })
            .send()
            .await
            .context("could not reach the service to poll the pairing")?;
        match response.status() {
            StatusCode::ACCEPTED => Ok(ClaimStatus::Pending),
            StatusCode::OK => {
                let claimed: ClaimedPairing = response
                    .json()
                    .await
                    .context("could not read the claimed credential")?;
                Ok(ClaimStatus::Claimed(credentials_from(claimed)))
            }
            StatusCode::GONE => Ok(ClaimStatus::Gone(
                "the pairing is no longer claimable (expired or already used)".to_owned(),
            )),
            status => {
                let message = response.text().await.unwrap_or_default();
                rootcause::bail!("the service refused the pairing poll ({status}): {message}");
            }
        }
    }
}

fn credentials_from(claimed: ClaimedPairing) -> HarnessCredentials {
    let scope = match claimed.harness.owner {
        HarnessOwner::User { .. } => HarnessScope::User,
        HarnessOwner::Team { .. } => HarnessScope::Team,
    };
    HarnessCredentials {
        harness_id: claimed.harness.id,
        token: claimed.token,
        scope,
    }
}

fn local_hostname() -> Option<String> {
    std::process::Command::new("hostname")
        .output()
        .ok()
        .filter(|output| output.status.success())
        .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_owned())
        .filter(|name| !name.is_empty())
}

fn host_info() -> String {
    let host = local_hostname().unwrap_or_else(|| "unknown-host".to_owned());
    format!("{host} / {}", std::env::consts::OS)
}
