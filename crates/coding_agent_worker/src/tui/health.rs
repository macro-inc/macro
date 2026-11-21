//! The four things the header reports, each derived on its own so a healthy
//! one never stands in for another: whether the serving core runs (daemon),
//! whether it holds the harness service's runtime connection (runtime),
//! what the agent-trigger event stream is doing (triggers), and where this
//! terminal runs (viewer).

#[cfg(test)]
mod test;

use std::time::Duration;

use tokio::sync::watch;
use tokio::time::Instant;
use tokio_util::task::AbortOnDropHandle;

use crate::daemon::TriggerStreamHealth;

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
    /// No connection here, yet the service lists the harness online: its
    /// presence lags a lost connection, or another process holds it.
    ServiceStillListsOnline,
    /// No connection, and the service does not know this harness (or has not
    /// answered yet).
    Unreachable,
    /// The daemon is stopped, so nothing holds it.
    Disconnected,
}

/// The agent-trigger event stream.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum TriggerHealth {
    /// Opening the stream.
    Connecting,
    /// No agent is bound, so no stream is open.
    NoAgentsBound,
    /// Open; the last event or heartbeat came `quiet` ago. `verified` when the
    /// service heartbeats the stream, so a quiet stream still shows its events
    /// flow; an older service's stream shows only that the connection is up.
    Live { verified: bool, quiet: Duration },
    /// The stream ended (a stall among the causes) and is reopening.
    Reconnecting { attempt: u32, last_error: String },
    /// The daemon is stopped.
    Stopped,
}

/// How often a herdr-core terminal's app tab is re-read: the app can adopt or
/// park it at any time.
#[cfg(unix)]
const VIEWER_CHECK_EVERY: Duration = Duration::from_secs(10);

/// Where this terminal can be seen.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(
    not(unix),
    expect(
        dead_code,
        reason = "only herdr, which is Unix-only, runs macrod elsewhere"
    )
)]
pub(crate) enum Viewer {
    /// Not in herdr: the terminal macrod was started in.
    Terminal,
    /// A herdr 0.9 pane, always on screen in its workspace.
    HerdrPane,
    /// A herdr-core terminal the herdr app holds in a tab (its `herdr.space`
    /// and `herdr.tab` labels).
    HerdrTab { terminal: String },
    /// A herdr-core terminal in no app tab; only `hc attach` reaches it.
    Background { terminal: String },
    /// A herdr-core terminal herdr-core has not described yet.
    Unknown { terminal: String },
    /// A herdr-core terminal started without `HC_BIN`, so macrod cannot ask
    /// herdr-core about it and opens no herdr windows.
    NoHcBin,
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
        (false, Some(true)) => RuntimeHealth::ServiceStillListsOnline,
        (false, Some(false)) => RuntimeHealth::Dialing,
        (false, None) => RuntimeHealth::Unreachable,
    }
}

/// `stream` is the running daemon's report, absent when no daemon runs: the
/// last state a stopped daemon published no longer counts.
pub(crate) fn triggers(stream: Option<&TriggerStreamHealth>, now: Instant) -> TriggerHealth {
    let Some(stream) = stream else {
        return TriggerHealth::Stopped;
    };
    match stream {
        TriggerStreamHealth::Connecting => TriggerHealth::Connecting,
        TriggerStreamHealth::NoAgentsBound => TriggerHealth::NoAgentsBound,
        TriggerStreamHealth::Live {
            verified,
            last_signal,
        } => TriggerHealth::Live {
            verified: *verified,
            quiet: now.saturating_duration_since(*last_signal),
        },
        TriggerStreamHealth::Reconnecting {
            attempt,
            last_error,
        } => TriggerHealth::Reconnecting {
            attempt: *attempt,
            last_error: top_line(last_error).to_owned(),
        },
    }
}

/// The first line of an error report, which can span several: a status line
/// and an event field hold one line.
pub(crate) fn top_line(error: &str) -> &str {
    error.lines().next().unwrap_or_default()
}

/// Where this terminal can be seen, kept current under herdr-core by a check
/// every [`VIEWER_CHECK_EVERY`] that lives as long as the returned handle.
pub(crate) fn watch_viewer() -> (watch::Receiver<Viewer>, Option<AbortOnDropHandle<()>>) {
    #[cfg(unix)]
    if let Some(session) = match crate::herdr::HerdrSession::detect() {
        Ok(session) => session,
        Err(crate::herdr::HcBinMissing) => return (watch::channel(Viewer::NoHcBin).1, None),
    } {
        let cli = session.cli();
        let crate::herdr::HerdrSession::Core { terminal, .. } = session else {
            return (watch::channel(Viewer::HerdrPane).1, None);
        };
        let (viewer_tx, viewer) = watch::channel(Viewer::Unknown {
            terminal: terminal.clone(),
        });
        let check = tokio::spawn(async move {
            let mut ticker = tokio::time::interval(VIEWER_CHECK_EVERY);
            loop {
                ticker.tick().await;
                let seen = in_app_tab(cli.shows_own_terminal().await, terminal.clone());
                viewer_tx.send_replace(seen);
            }
        });
        return (viewer, Some(AbortOnDropHandle::new(check)));
    }
    (watch::channel(Viewer::Terminal).1, None)
}

/// A herdr-core terminal's viewer from one read of its labels.
#[cfg(unix)]
pub(crate) fn in_app_tab(
    shown: Result<bool, crate::herdr::cli::HerdrError>,
    terminal: String,
) -> Viewer {
    match shown {
        Ok(true) => Viewer::HerdrTab { terminal },
        Ok(false) => Viewer::Background { terminal },
        Err(error) => {
            tracing::debug!(%error, "could not read macrod's herdr-core terminal");
            Viewer::Unknown { terminal }
        }
    }
}
