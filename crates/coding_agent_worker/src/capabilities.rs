//! Capability and persona-health reports, only for enrolled Macro computers.

use std::time::{Duration, Instant};

use harnesses::domain::models::HarnessCapabilities;
#[cfg(unix)]
use harnesses::domain::models::PersonaHealth;
use rootcause::prelude::ResultExt as _;
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;

use crate::config::{HarnessCredentials, MacroApi};

#[cfg(test)]
mod test;

const HARNESS_TOKEN_HEADER: &str = "x-macro-harness-token";
/// The box image's Xvnc display.
pub const SCREEN_ADDRESS: &str = "127.0.0.1:5900";
const PROBE_TIMEOUT: Duration = Duration::from_secs(1);
const PROBE_INTERVAL: Duration = Duration::from_secs(15);
const SCREEN_INTERVAL: Duration = Duration::from_secs(60);
const REPORT_TIMEOUT: Duration = Duration::from_secs(10);

async fn listening(address: &str) -> bool {
    matches!(
        tokio::time::timeout(PROBE_TIMEOUT, tokio::net::TcpStream::connect(address)).await,
        Ok(Ok(_))
    )
}

/// Written last by enrollment; only computers bearing this marker report.
pub const ENROLLED_MARKER: &str = "/var/lib/macrod/enrolled";

/// Whether this machine is an enrolled Macro computer.
pub fn is_macro_computer() -> bool {
    cfg!(unix) && std::path::Path::new(ENROLLED_MARKER).exists()
}

/// Track the reporter with the daemon so cancellation interrupts probes and
/// reports. Privileged commands use nonblocking systemd jobs and kill their
/// direct child on cancellation; systemd owns the resulting brain process.
pub fn spawn_reporter(
    config: &MacroApi,
    credentials: &HarnessCredentials,
    cancel: CancellationToken,
    tasks: &TaskTracker,
) -> rootcause::Result<()> {
    let http = report_client_builder()
        .build()
        .context("could not build the capability report client")?;
    let url = format!(
        "{}/harnesses/me/capabilities",
        config.storage_url.trim_end_matches('/')
    );
    let token = credentials.token.clone();
    #[cfg(unix)]
    let mut personas = crate::domain::personas::Supervisor::new(
        crate::outbound::personas::Systemd,
        crate::outbound::personas::HttpHealth::new()
            .context("could not build the brain health client")?,
    );
    track_reporter(tasks, cancel, async move {
        let mut reported = None;
        let mut current = HarnessCapabilities::default();
        let mut screen_at = Instant::now();
        let mut interval = tokio::time::interval(PROBE_INTERVAL);
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            let now = Instant::now();
            if now >= screen_at {
                current.screen = listening(SCREEN_ADDRESS).await;
                screen_at = now + SCREEN_INTERVAL;
            }
            #[cfg(unix)]
            match crate::outbound::personas::discover().await {
                Ok(config) => {
                    current.personas = personas.snapshot(&config, now, chrono::Utc::now()).await;
                }
                Err(error) => {
                    tracing::warn!(error = ?error, "persona discovery failed");
                    for health in current.personas.values_mut() {
                        let last_turn_at = match health {
                            PersonaHealth::Healthy { last_turn_at, .. }
                            | PersonaHealth::Unhealthy { last_turn_at, .. }
                            | PersonaHealth::Missing { last_turn_at, .. } => *last_turn_at,
                        };
                        *health = PersonaHealth::Unhealthy {
                            checked_at: chrono::Utc::now(),
                            last_error: "could not discover enrolled personas".to_owned(),
                            last_turn_at,
                        };
                    }
                }
            }
            if reported.as_ref() != Some(&current) {
                match report(&http, &url, &token, &current).await {
                    Ok(()) => reported = Some(current.clone()),
                    Err(error) => tracing::warn!(error = ?error, "capability report failed"),
                }
            }
        }
    });
    Ok(())
}

fn report_client_builder() -> reqwest::ClientBuilder {
    reqwest::Client::builder()
        .timeout(REPORT_TIMEOUT)
        // Repeated health polls must not pin a reassigned service IP forever.
        .pool_max_idle_per_host(0)
}

fn track_reporter(
    tasks: &TaskTracker,
    cancel: CancellationToken,
    work: impl Future<Output = ()> + Send + 'static,
) {
    tasks.spawn(async move {
        tokio::select! {
            () = cancel.cancelled() => {},
            () = work => {},
        }
    });
}

#[tracing::instrument(name = "macrod.capabilities.report", skip_all, fields(screen = capabilities.screen, persona_count = capabilities.personas.len()), err)]
async fn report(
    http: &reqwest::Client,
    url: &str,
    token: &str,
    capabilities: &HarnessCapabilities,
) -> rootcause::Result<()> {
    let mut headers = reqwest::header::HeaderMap::new();
    macro_tower_layers::inject_trace_headers(&mut headers);
    let status = http
        .put(url)
        .headers(headers)
        .header(HARNESS_TOKEN_HEADER, token)
        .json(capabilities)
        .send()
        .await
        .context("could not reach the service to report capabilities")?
        .status();
    if !status.is_success() {
        rootcause::bail!("capability report returned HTTP {status}");
    }
    Ok(())
}
