//! What the agent-trigger stream is doing, for the control panel to show.

use tokio::time::Instant;

#[cfg(test)]
mod test;

/// The agent-trigger stream's state, published on [`super::Daemon::trigger_stream_health`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TriggerStreamHealth {
    /// Opening the stream.
    Connecting,
    /// No agent is bound to this harness, so no stream is open.
    NoAgentsBound,
    /// The stream is open.
    Live {
        /// Whether the service heartbeats this stream. Only then does a quiet
        /// stream show its events still flow; an older service's stream says
        /// only that the connection is up.
        verified: bool,
        /// The last event or heartbeat, or the open.
        last_signal: Instant,
    },
    /// The stream ended and is about to reopen.
    Reconnecting {
        /// Reconnects since the stream was last live, from 1.
        attempt: u32,
        /// Why it ended, including a stall.
        last_error: String,
    },
}

impl TriggerStreamHealth {
    /// An agent is bound again after none was: the stream is opening. A
    /// reconnect keeps its attempt. Whether this changed the state.
    pub(super) fn agents_bound(&mut self) -> bool {
        let idle = matches!(self, Self::NoAgentsBound);
        if idle {
            *self = Self::Connecting;
        }
        idle
    }
}
