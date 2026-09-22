//! The daemon's persistent connection to the harness service and the ACP
//! process behind it. Connecting when the daemon starts lets the service probe
//! models before the first agent is created. One connection carries every
//! session of every agent bound to this harness.

use std::path::{Path, PathBuf};
use std::time::Duration;

use tokio::sync::watch;
use tokio::time::Instant;
use tokio_retry::strategy::ExponentialBackoff;
use tokio_tungstenite::tungstenite;
use tokio_util::task::AbortOnDropHandle;

use crate::config::{Harness, HarnessCredentials, MacroApi};
use crate::harness;
use crate::outbound::link;

#[cfg(test)]
mod test;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_RECONNECT_DELAY: Duration = Duration::from_secs(30);

/// The daemon's connection to its harness's sessions.
///
/// Owns one connection supervisor, independent of trigger delivery. Dropping
/// the runtime aborts the supervisor and drops its bridge, which closes the
/// socket and terminates the ACP process group.
pub struct Runtime {
    connected: watch::Receiver<bool>,
    _task: AbortOnDropHandle<()>,
}

impl Runtime {
    /// Start connecting with the given credentials and keep the harness
    /// available for model discovery and agent sessions until dropped.
    pub fn start(
        macro_api: &MacroApi,
        credentials: &HarnessCredentials,
        harness: Harness,
        cwd: &Path,
    ) -> Self {
        let (connected_tx, connected) = watch::channel(false);
        let task = tokio::spawn(serve(
            macro_api.gateway_url(),
            credentials.token.clone(),
            harness,
            cwd.to_owned(),
            connected_tx,
        ));
        Self {
            connected,
            _task: AbortOnDropHandle::new(task),
        }
    }

    /// Wait briefly for the supervisor to connect before dispatching a prompt.
    /// Callers never open a second connection while it is reconnecting.
    pub async fn ensure_connected(&self) -> Result<(), tungstenite::Error> {
        let mut connected = self.connected.clone();
        match tokio::time::timeout(CONNECT_TIMEOUT, connected.wait_for(|ready| *ready)).await {
            Ok(Ok(_)) => Ok(()),
            Ok(Err(_)) => Err(tungstenite::Error::ConnectionClosed),
            Err(_) => Err(tungstenite::Error::Io(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                "the runtime gateway did not connect in time",
            ))),
        }
    }
}

/// Reconnect even after a clean close or a long outage: model discovery must
/// recover without requiring an agent mention. Authentication failures stop
/// the supervisor until the user re-pairs or restarts the daemon.
async fn serve(
    gateway_url: String,
    token: String,
    harness: Harness,
    cwd: PathBuf,
    connected: watch::Sender<bool>,
) {
    let mut backoff = reconnect_strategy();
    loop {
        match tokio::time::timeout(CONNECT_TIMEOUT, link::dial(&gateway_url, &token)).await {
            Ok(Ok(channel)) => {
                connected.send_replace(true);
                tracing::info!("harness bridge starting");
                let started = Instant::now();
                match harness::bridge(&harness, &cwd, channel).await {
                    Ok(()) => tracing::info!("harness bridge ended; reconnecting"),
                    Err(error) => {
                        tracing::warn!(error = ?error, "harness bridge ended; reconnecting");
                    }
                }
                connected.send_replace(false);
                if started.elapsed() >= MAX_RECONNECT_DELAY {
                    backoff = reconnect_strategy();
                }
            }
            Ok(Err(error)) => {
                if !worth_redialing(&error) {
                    tracing::error!(error = ?error, "runtime connection refused; check configuration or re-pair");
                    return;
                }
                tracing::warn!(error = ?error, "runtime connection failed; reconnecting");
            }
            Err(_) => tracing::warn!("runtime connection timed out; reconnecting"),
        }
        tokio::time::sleep(backoff.next().unwrap_or(MAX_RECONNECT_DELAY)).await;
    }
}

/// Retry transport failures, server errors, and temporary HTTP refusals.
/// Other 4xx responses require an operator to fix configuration or credentials.
fn worth_redialing(error: &tungstenite::Error) -> bool {
    if matches!(error, tungstenite::Error::Url(_)) {
        return false;
    }
    let tungstenite::Error::Http(response) = error else {
        return true;
    };
    let status = response.status();
    !status.is_client_error()
        || status == tungstenite::http::StatusCode::REQUEST_TIMEOUT
        || status == tungstenite::http::StatusCode::TOO_MANY_REQUESTS
}

fn reconnect_strategy() -> ExponentialBackoff {
    ExponentialBackoff::from_millis(2)
        .factor(500)
        .max_delay(MAX_RECONNECT_DELAY)
}
