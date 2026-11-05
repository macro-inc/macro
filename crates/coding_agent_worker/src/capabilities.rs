//! Tell Macro what a Macro computer can do beyond running agents, e.g. that
//! it has a display to stream.
//!
//! Only enrolled Macro computers report: a display on a user's own machine
//! is never offered to Macro. Probed when the serving core starts and
//! re-probed periodically, since the display can come up after macrod; a
//! report goes out only on a change or after a failed one.

use std::time::Duration;

use harnesses::domain::models::HarnessCapabilities;
use rootcause::prelude::ResultExt as _;
use tokio_util::sync::CancellationToken;

use crate::config::{HarnessCredentials, MacroApi};

#[cfg(test)]
mod test;

const HARNESS_TOKEN_HEADER: &str = "x-macro-harness-token";
/// The box image's Xvnc display.
const SCREEN_ADDRESS: &str = "127.0.0.1:5900";
const PROBE_TIMEOUT: Duration = Duration::from_secs(1);
const PROBE_INTERVAL: Duration = Duration::from_secs(60);
const REPORT_TIMEOUT: Duration = Duration::from_secs(10);

/// What this machine can do right now.
async fn probe() -> HarnessCapabilities {
    HarnessCapabilities {
        screen: listening(SCREEN_ADDRESS).await,
    }
}

async fn listening(address: &str) -> bool {
    matches!(
        tokio::time::timeout(PROBE_TIMEOUT, tokio::net::TcpStream::connect(address)).await,
        Ok(Ok(_))
    )
}

/// Written last by `macrod enroll`; its presence means this machine is an
/// enrolled Macro computer.
pub const ENROLLED_MARKER: &str = "/var/lib/macrod/enrolled";

/// Whether this machine is an enrolled Macro computer.
pub fn is_macro_computer() -> bool {
    cfg!(unix) && std::path::Path::new(ENROLLED_MARKER).exists()
}

/// Report capabilities until `cancel` fires.
pub fn spawn_reporter(
    config: &MacroApi,
    credentials: &HarnessCredentials,
    cancel: CancellationToken,
) -> rootcause::Result<tokio::task::JoinHandle<()>> {
    let http = reqwest::Client::builder()
        .timeout(REPORT_TIMEOUT)
        .build()
        .context("could not build the capability report client")?;
    let url = format!(
        "{}/harnesses/me/capabilities",
        config.storage_url.trim_end_matches('/')
    );
    let token = credentials.token.clone();
    Ok(tokio::spawn(async move {
        let mut reported = None;
        loop {
            let current = probe().await;
            if reported != Some(current) {
                match report(&http, &url, &token, current).await {
                    Ok(()) => reported = Some(current),
                    Err(error) => tracing::warn!(error = ?error, "capability report failed"),
                }
            }
            tokio::select! {
                () = cancel.cancelled() => return,
                () = tokio::time::sleep(PROBE_INTERVAL) => {}
            }
        }
    }))
}

#[tracing::instrument(name = "macrod.capabilities.report", skip(http, url, token), err)]
async fn report(
    http: &reqwest::Client,
    url: &str,
    token: &str,
    capabilities: HarnessCapabilities,
) -> rootcause::Result<()> {
    let response = http
        .put(url)
        .header(HARNESS_TOKEN_HEADER, token)
        .json(&capabilities)
        .send()
        .await
        .context("could not reach the service to report capabilities")?;
    let status = response.status();
    if status.is_success() {
        return Ok(());
    }
    let message = response.text().await.unwrap_or_default();
    rootcause::bail!("the service answered {status} to the capability report: {message}")
}
