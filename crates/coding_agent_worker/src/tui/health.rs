//! The four things the header reports, each derived on its own so a healthy
//! one never stands in for another: whether the serving core runs (daemon),
//! whether it holds the harness service's runtime connection (runtime),
//! what the agent-trigger event stream is doing (triggers), and where this
//! terminal runs (viewer).

#[cfg(test)]
mod test;

use std::time::Duration;

use tokio::time::Instant;

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

/// Where this terminal runs. Whether a herdr-core terminal is on screen is
/// not known: herdr-core has no query that says whether the herdr app shows it
/// as a tab, so a terminal is only named, with how to attach to it.
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
    /// A herdr-core terminal, which may run in the background.
    HerdrCore { terminal: String },
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

/// Where this terminal runs.
pub(crate) fn viewer() -> Viewer {
    #[cfg(unix)]
    match crate::herdr::HerdrSession::detect() {
        Some(crate::herdr::HerdrSession::Core { terminal, .. }) => {
            return Viewer::HerdrCore { terminal };
        }
        Some(crate::herdr::HerdrSession::Legacy { .. }) => return Viewer::HerdrPane,
        None => {}
    }
    Viewer::Terminal
}
