//! The harness child process and the bridge between its stdio and the
//! gateway channel.

use crate::config::Harness;
use agent_client_protocol::{AcpAgent, AcpAgentConfig, Client, ConnectTo};
use agent_runtime_protocol::domain::connection::{
    ConnectionError, RuntimeChannel, RuntimeConnection,
};
use agent_runtime_protocol::domain::schema::v0::SystemEvent;

#[cfg(test)]
mod test;

/// Why the bridge ended.
#[derive(Debug, thiserror::Error)]
pub enum BridgeError {
    /// The service connection closed before the harness could be announced.
    #[error("the service connection closed before the harness was announced")]
    Announce(#[source] ConnectionError),
    /// The harness could not be spawned, or its ACP session ended in failure.
    #[error("the harness process ended in failure: {0}")]
    Harness(String),
}

/// Spawn the harness in ACP mode and pump frames until either side ends.
pub async fn bridge(harness: &Harness, channel: RuntimeChannel) -> Result<(), BridgeError> {
    let (runtime, acp) = RuntimeConnection::connect(channel);

    let agent = AcpAgent::new(AcpAgentConfig::new(&harness.command).args(harness.args.clone()))
        // The wire tap: every ndjson line crossing the child's stdio, plus
        // its stderr. Enable with RUST_LOG=coding_agent_worker=trace.
        .with_debug(|line, direction| {
            tracing::trace!(?direction, line, "acp line");
        });

    runtime
        .system_event(SystemEvent::AcpReady)
        .map_err(BridgeError::Announce)?;

    let outcome = ConnectTo::<Client>::connect_to(agent, acp).await;

    // Best effort: a transport that has already failed cannot carry news of
    // its own failure, and that is not itself worth failing the worker over.
    if let Err(error) = runtime.system_event(SystemEvent::Disconnected) {
        tracing::debug!(error = ?error, "could not announce disconnect");
    }

    outcome.map_err(|error| BridgeError::Harness(error.to_string()))
}
