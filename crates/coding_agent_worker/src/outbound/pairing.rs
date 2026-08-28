//! The daemon's half of device-code pairing: ask for a code, tell the user
//! where to approve it, poll until the credential is released.

use std::time::Duration;

use harnesses::domain::models::{
    ClaimPairingRequest, ClaimedPairing, CreatePairingRequest, CreatedPairing,
    RequestedHarnessScope,
};
use reqwest::StatusCode;
use rootcause::prelude::ResultExt as _;

use crate::config::Config;
use crate::outbound::credentials::{HarnessCredentials, HarnessScope};

/// How long past the server-stated expiry polling keeps trying: zero. The
/// server keeps an approved pairing claimable, so expiry here only ends the
/// wait for a user who never approved.
const POLL_GRACE: Duration = Duration::ZERO;

/// Walk the whole pairing flow interactively and return minted credentials.
///
/// Prints the code and approval link to stdout on purpose: this is the one
/// conversation the daemon has with a human.
pub async fn pair(config: &Config) -> rootcause::Result<HarnessCredentials> {
    let http = reqwest::Client::new();
    let base = config
        .macro_api
        .storage_url
        .trim_end_matches('/')
        .to_owned();

    let name = config
        .identity
        .name
        .clone()
        .or_else(local_hostname)
        .unwrap_or_else(|| "macrod".to_owned());
    let host = host_info();
    let scope = match config.identity.scope {
        crate::config::IdentityScope::Private => RequestedHarnessScope::Private,
        crate::config::IdentityScope::Team => RequestedHarnessScope::Team,
    };

    let response = http
        .post(format!("{base}/harness-pairings"))
        .json(&CreatePairingRequest {
            name,
            host: Some(host),
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
    let pairing: CreatedPairing = response
        .json()
        .await
        .context("could not read the pairing the service created")?;

    let approval_url = config.macro_api.pairing_approval_url(&pairing.code);
    let expires_in = (pairing.expires_at - chrono::Utc::now())
        .to_std()
        .unwrap_or_default();
    println!();
    println!("  Your pairing code:  {}", pairing.code);
    let scope_word = match scope {
        RequestedHarnessScope::Private => "private",
        RequestedHarnessScope::Team => "team",
    };
    println!();
    println!("  Open  {approval_url}");
    println!("  and approve this daemon (confirm the code; it asks to be {scope_word}).");
    println!();
    println!(
        "  Waiting for approval... (expires in {} minutes)",
        expires_in.as_secs() / 60
    );

    let poll_interval = Duration::from_secs(pairing.poll_interval_seconds.max(1));
    let deadline = tokio::time::Instant::now() + expires_in + POLL_GRACE;
    loop {
        tokio::time::sleep(poll_interval).await;
        if tokio::time::Instant::now() > deadline {
            rootcause::bail!(
                "the pairing expired before it was approved; run `macrod login` to start over"
            );
        }

        let response = http
            .post(format!(
                "{base}/harness-pairings/{}/claim",
                pairing.pairing_id
            ))
            .json(&ClaimPairingRequest {
                device_secret: pairing.device_secret.clone(),
            })
            .send()
            .await
            .context("could not reach the service to poll the pairing")?;
        match response.status() {
            StatusCode::ACCEPTED => continue,
            StatusCode::OK => {
                let claimed: ClaimedPairing = response
                    .json()
                    .await
                    .context("could not read the claimed credential")?;
                let scope = match claimed.harness.owner {
                    harnesses::domain::models::HarnessOwner::User { .. } => HarnessScope::User,
                    harnesses::domain::models::HarnessOwner::Team { .. } => HarnessScope::Team,
                };
                println!(
                    "Approved. This machine is now the harness \"{}\" ({}).",
                    claimed.harness.name, claimed.harness.id
                );
                return Ok(HarnessCredentials {
                    harness_id: claimed.harness.id,
                    token: claimed.token,
                    scope,
                });
            }
            StatusCode::GONE => {
                rootcause::bail!(
                    "the pairing is no longer claimable (expired or already used); run `macrod login` to start over"
                );
            }
            status => {
                let message = response.text().await.unwrap_or_default();
                rootcause::bail!("the service refused the pairing poll ({status}): {message}");
            }
        }
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
