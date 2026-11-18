//! The daemon's persistent connection to the harness service and the ACP
//! process behind it. Connecting when the daemon starts lets the service probe
//! models before the first agent is created. One connection carries every
//! session of every agent bound to this harness.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::{Notify, watch};
use tokio::time::Instant;
use tokio_tungstenite::tungstenite;
use tokio_util::task::AbortOnDropHandle;

use crate::computer::Computer;
use crate::config::{Harness, HarnessCredentials, MacroApi};
use crate::harness::{self, BridgeEnd, Handoffs, LineTap};
use crate::outbound::acp_process::RunningAgent;
use crate::outbound::link;
use crate::retry_delay::RetryDelays;
use crate::turns::ActiveTurns;

#[cfg(test)]
mod test;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
/// How long one dial may take before it is retried.
const DIAL_TIMEOUT: Duration = Duration::from_secs(5);
/// A connection that lasted this long was healthy: its loss is redialed at
/// once rather than after a backoff step.
const HEALTHY_CONNECTION: Duration = Duration::from_secs(10);
/// The first redial after a failure; later ones double up to the cap. Short:
/// a booting computer's first dial often races its network.
const FIRST_RECONNECT_DELAY: Duration = Duration::from_millis(250);
const MAX_RECONNECT_DELAY: Duration = Duration::from_secs(30);

/// The daemon's connection to its harness's sessions.
///
/// Owns one connection supervisor, independent of trigger delivery. Dropping
/// the runtime aborts the supervisor and drops its bridge, which closes the
/// socket and terminates the ACP process group.
pub struct Runtime {
    connected: watch::Receiver<bool>,
    agents_changed: Arc<Notify>,
    _task: AbortOnDropHandle<()>,
}

impl Runtime {
    /// Start connecting with the given credentials and keep the harness
    /// available for model discovery and agent sessions until dropped.
    #[expect(clippy::too_many_arguments, reason = "the supervisor's whole input")]
    pub fn start(
        macro_api: &MacroApi,
        credentials: &HarnessCredentials,
        harness: Harness,
        cwd: &Path,
        tap: Option<LineTap>,
        turns: ActiveTurns,
        adopted: Option<RunningAgent>,
        handoffs: Handoffs,
        computer: Option<Arc<Computer>>,
    ) -> Self {
        let (connected_tx, connected) = watch::channel(false);
        let agents_changed = Arc::new(Notify::new());
        let task = tokio::spawn(serve(
            macro_api.gateway_url(),
            credentials.token.clone(),
            harness,
            cwd.to_owned(),
            tap,
            turns,
            connected_tx,
            Arc::clone(&agents_changed),
            adopted,
            handoffs,
            computer,
        ));
        Self {
            connected,
            agents_changed,
            _task: AbortOnDropHandle::new(task),
        }
    }

    /// Follows whether the runtime connection is currently up.
    pub fn connection_state(&self) -> watch::Receiver<bool> {
        self.connected.clone()
    }

    /// Raised when the service says the agents bound to this harness may have
    /// changed. A raise while nobody waits is kept for the next waiter.
    pub fn agents_changed(&self) -> Arc<Notify> {
        Arc::clone(&self.agents_changed)
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
///
/// An `adopted` agent (handed over by the previous process image) serves the
/// first connection instead of a fresh spawn. Otherwise the agent is started
/// before each dial, so it boots while the socket opens. A handoff request ends the
/// supervisor: the bridge answers it with its agent, and between bridges it
/// is answered with whatever agent is still waiting for a connection.
#[expect(clippy::too_many_arguments, reason = "the supervisor's whole input")]
async fn serve(
    gateway_url: String,
    token: String,
    harness: Harness,
    cwd: PathBuf,
    tap: Option<LineTap>,
    turns: ActiveTurns,
    connected: watch::Sender<bool>,
    agents_changed: Arc<Notify>,
    mut adopted: Option<RunningAgent>,
    mut handoffs: Handoffs,
    computer: Option<Arc<Computer>>,
) {
    let mut backoff = reconnect_strategy();
    loop {
        let mut lasted = None;
        if adopted.is_none() {
            adopted = start_ahead(&harness, &cwd);
        }
        let dialed = tokio::select! {
            dialed = tokio::time::timeout(DIAL_TIMEOUT, link::dial(&gateway_url, &token)) => dialed,
            request = handoffs.next() => {
                answer_between_bridges(request, adopted.take(), &turns);
                return;
            }
        };
        match dialed {
            Ok(Ok(channel)) => {
                connected.send_replace(true);
                tracing::info!(adopted = adopted.is_some(), "harness bridge starting");
                let started = Instant::now();
                match harness::bridge(
                    &harness,
                    &cwd,
                    channel,
                    tap.clone(),
                    &turns,
                    adopted.take(),
                    &mut handoffs,
                    computer.clone(),
                    &agents_changed,
                )
                .await
                {
                    Ok(BridgeEnd::Closed) => tracing::info!("harness bridge ended; reconnecting"),
                    #[cfg(unix)]
                    Ok(BridgeEnd::HandedOff) => {
                        tracing::info!("harness bridge handed its agent off");
                        connected.send_replace(false);
                        return;
                    }
                    Err(error) => {
                        tracing::warn!(error = ?error, "harness bridge ended; reconnecting");
                    }
                }
                connected.send_replace(false);
                lasted = Some(started.elapsed());
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
        tokio::select! {
            () = tokio::time::sleep(redial_delay(lasted, &mut backoff)) => {}
            request = handoffs.next() => {
                answer_between_bridges(request, adopted.take(), &turns);
                return;
            }
        }
    }
}

/// Start the agent while the runtime dials, so a session that arrives with
/// the connection (a computer's first prompt) does not also wait for the
/// agent's own startup: a Node adapter takes a quarter of a second or more.
/// It stays ready across failed dials. A failed start is left to the bridge,
/// which starts it again and reports why it could not.
fn start_ahead(harness: &Harness, cwd: &Path) -> Option<RunningAgent> {
    let _span = tracing::info_span!("macrod.agent.start_ahead").entered();
    harness::agent_process(harness, cwd)
        .start()
        .inspect_err(
            |error| tracing::warn!(error = ?error, "could not start the agent ahead of the dial"),
        )
        .ok()
}

/// Answer a handoff that arrived while no bridge was relaying: only an agent
/// adopted or started ahead, and not yet connected, is running.
#[cfg(unix)]
fn answer_between_bridges(
    reply: harness::HandoffRequest,
    adopted: Option<RunningAgent>,
    turns: &ActiveTurns,
) {
    let handed = adopted.and_then(|agent| {
        agent
            .hand_off(turns.snapshot())
            .inspect_err(|error| tracing::warn!(error = ?error, "could not hand the agent off"))
            .ok()
    });
    let _ = reply.send(handed);
}

#[cfg(not(unix))]
fn answer_between_bridges(
    request: std::convert::Infallible,
    _adopted: Option<RunningAgent>,
    _turns: &ActiveTurns,
) {
    match request {}
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

/// How long to wait before the next dial, given how long the last
/// connection lasted (`None` when the dial itself failed).
fn redial_delay(lasted: Option<Duration>, backoff: &mut RetryDelays) -> Duration {
    if lasted.is_some_and(|lasted| lasted >= HEALTHY_CONNECTION) {
        backoff.reset();
        return Duration::ZERO;
    }
    backoff.next_delay()
}

fn reconnect_strategy() -> RetryDelays {
    RetryDelays::new(FIRST_RECONNECT_DELAY, MAX_RECONNECT_DELAY)
}
