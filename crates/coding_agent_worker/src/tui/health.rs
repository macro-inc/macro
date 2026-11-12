//! The four things the header reports, each derived on its own so a healthy
//! one never stands in for another: whether the serving core runs (daemon),
//! whether it holds the harness service's runtime connection (runtime),
//! whether the agent-trigger event stream is still heard from (triggers), and
//! where this terminal can be seen (viewer).

#[cfg(test)]
mod test;

use std::time::Duration;

use tokio::sync::watch;
use tokio::time::Instant;
use tokio_util::task::AbortOnDropHandle;

use crate::daemon::{StreamEnd, TriggerStream};
use crate::outbound::stream::SILENCE_LIMIT;

/// How often macrod asks herdr-core whether the herdr app shows its terminal.
#[cfg(unix)]
const VIEWER_CHECK_EVERY: Duration = Duration::from_secs(30);

/// All four, as of one frame.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Health {
    pub(crate) daemon: DaemonHealth,
    pub(crate) runtime: RuntimeHealth,
    pub(crate) triggers: TriggerHealth,
    pub(crate) viewer: Viewer,
}

/// Whether the serving core runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DaemonHealth {
    /// No credential, so nothing to serve.
    NotPaired,
    Running,
    /// Paired, but the serving task ended or never started.
    Stopped,
}

/// The runtime connection to the harness service.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RuntimeHealth {
    /// This process holds it and the service agrees.
    Connected,
    /// This process holds it, but the service reads the harness as offline.
    ServiceReportsOffline,
    /// The daemon runs but holds no connection yet.
    Dialing,
    /// No connection, and the service does not know this harness (or has not
    /// answered yet).
    Unreachable,
    /// The daemon is stopped, so nothing holds it.
    Disconnected,
}

/// The agent-trigger event stream.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum TriggerHealth {
    /// Opening the first stream.
    Connecting,
    /// No agent is bound, so no stream is open.
    Unbound,
    /// Open, and the server was last heard from `quiet` ago.
    Live { quiet: Duration },
    /// Open, but silent past [`SILENCE_LIMIT`]: about to be dropped, or the
    /// serving loop is stuck elsewhere.
    Stalled { quiet: Duration },
    /// Retrying after the last stream or attempt ended.
    Reconnecting { attempt: u32, cause: StreamEnd },
    /// The daemon is stopped.
    Stopped,
}

/// Where this terminal can be seen.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(
    not(unix),
    expect(
        dead_code,
        reason = "only herdr, which is Unix-only, shows macrod elsewhere"
    )
)]
pub(crate) enum Viewer {
    /// Not in herdr: the terminal macrod was started in.
    Terminal,
    /// A herdr 0.9 pane, always on screen in its workspace.
    HerdrPane,
    /// A herdr-core terminal the herdr app shows as a tab.
    HerdrTab { terminal: String },
    /// A herdr-core terminal no app tab shows; only `hc attach` reaches it.
    Background { terminal: String },
    /// A herdr-core terminal herdr-core has not described yet.
    Unknown { terminal: String },
}

pub(crate) fn daemon(paired: bool, running: bool) -> DaemonHealth {
    match (paired, running) {
        (false, _) => DaemonHealth::NotPaired,
        (true, true) => DaemonHealth::Running,
        (true, false) => DaemonHealth::Stopped,
    }
}

/// `held` is whether this process holds the connection, which outranks the
/// service's flag (`service`, absent when it does not know the harness): that
/// flag lags a dial and can name a connection another process holds.
pub(crate) fn runtime(running: bool, held: bool, service: Option<bool>) -> RuntimeHealth {
    if !running {
        return RuntimeHealth::Disconnected;
    }
    match (held, service) {
        (true, Some(false)) => RuntimeHealth::ServiceReportsOffline,
        (true, _) => RuntimeHealth::Connected,
        (false, Some(_)) => RuntimeHealth::Dialing,
        (false, None) => RuntimeHealth::Unreachable,
    }
}

/// `stream` is the running daemon's report, absent when no daemon runs.
pub(crate) fn triggers(stream: Option<&TriggerStream>, now: Instant) -> TriggerHealth {
    let Some(stream) = stream else {
        return TriggerHealth::Stopped;
    };
    match stream {
        TriggerStream::Connecting => TriggerHealth::Connecting,
        TriggerStream::Unbound => TriggerHealth::Unbound,
        TriggerStream::Open { heard } => {
            let quiet = now.saturating_duration_since(*heard.borrow());
            if quiet >= SILENCE_LIMIT {
                TriggerHealth::Stalled { quiet }
            } else {
                TriggerHealth::Live { quiet }
            }
        }
        TriggerStream::Reconnecting { attempt, cause } => TriggerHealth::Reconnecting {
            attempt: *attempt,
            cause: cause.clone(),
        },
    }
}

/// Where this terminal can be seen, kept current under herdr-core by a check
/// every [`VIEWER_CHECK_EVERY`] that lives as long as the returned handle.
pub(crate) fn watch_viewer() -> (watch::Receiver<Viewer>, Option<AbortOnDropHandle<()>>) {
    #[cfg(unix)]
    if let Some(session) = crate::herdr::HerdrSession::detect() {
        let cli = session.cli();
        let crate::herdr::HerdrSession::Core { terminal } = session else {
            return (watch::channel(Viewer::HerdrPane).1, None);
        };
        let (viewer_tx, viewer) = watch::channel(Viewer::Unknown {
            terminal: terminal.clone(),
        });
        let check = tokio::spawn(async move {
            let mut ticker = tokio::time::interval(VIEWER_CHECK_EVERY);
            loop {
                ticker.tick().await;
                let terminal = terminal.clone();
                let seen = match cli.shows_own_terminal().await {
                    Ok(true) => Viewer::HerdrTab { terminal },
                    Ok(false) => Viewer::Background { terminal },
                    Err(error) => {
                        tracing::debug!(%error, "could not read macrod's herdr-core terminal");
                        Viewer::Unknown { terminal }
                    }
                };
                viewer_tx.send_replace(seen);
            }
        });
        return (viewer, Some(AbortOnDropHandle::new(check)));
    }
    (watch::channel(Viewer::Terminal).1, None)
}
