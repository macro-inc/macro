//! The harness child process and the bridge between its stdio and the
//! gateway channel.

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use crate::config::Harness;
use crate::outbound::acp_probe::{ProbeError, ProbeSubprocess, probe_subprocess};
use crate::outbound::acp_process::AcpProcess;
use agent_client_protocol::{Client, ConnectTo, LineDirection};
use agent_runtime_protocol::domain::connection::{
    ConnectionError, ModelProbeHandler, RuntimeChannel, RuntimeConnection,
};
use agent_runtime_protocol::domain::schema::v0::SystemEvent;

#[cfg(test)]
mod test;

const MODEL_PROBE_TIMEOUT: Duration = Duration::from_secs(10);

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

/// Observes every line crossing the harness's stdio.
pub type LineTap = Arc<dyn Fn(&str, LineDirection) + Send + Sync>;

/// Spawn the harness in ACP mode and pump frames until either side ends,
/// handing every ACP line to `tap` when there is one.
pub async fn bridge(
    harness: &Harness,
    cwd: &Path,
    channel: RuntimeChannel,
    tap: Option<LineTap>,
) -> Result<(), BridgeError> {
    let probes = HarnessModelProbes {
        process: probe_process(harness, cwd),
    };
    let (mut runtime, acp) = RuntimeConnection::connect_with_model_probe_handler(channel, probes);

    let agent = AcpProcess::new(&harness.command, harness.args.clone(), cwd)
        .envs(harness.env.clone())
        // The wire tap: every ndjson line crossing the child's stdio, plus
        // its stderr. Enable with RUST_LOG=coding_agent_worker=trace.
        .with_debug(move |line, direction| {
            tracing::trace!(?direction, line, "acp line");
            if let Some(tap) = &tap {
                tap(line, direction);
            }
        });

    runtime
        .system_event(SystemEvent::AcpReady)
        .map_err(BridgeError::Announce)?;

    let outcome = tokio::select! {
        outcome = ConnectTo::<Client>::connect_to(agent, acp) => outcome,
        () = runtime.closed() => Ok(()),
    };

    // Best effort: a transport that has already failed cannot carry news of
    // its own failure, and that is not itself worth failing the worker over.
    if let Err(error) = runtime.system_event(SystemEvent::Disconnected) {
        tracing::debug!(error = ?error, "could not announce disconnect");
    }

    outcome.map_err(|error| BridgeError::Harness(error.to_string()))
}

fn probe_process(harness: &Harness, cwd: &Path) -> ProbeSubprocess {
    ProbeSubprocess {
        command: harness.command.clone().into(),
        args: harness.args.clone(),
        cwd: cwd.to_owned(),
        env: harness.env.clone(),
    }
}

#[derive(Clone)]
struct HarnessModelProbes {
    process: ProbeSubprocess,
}

impl ModelProbeHandler for HarnessModelProbes {
    async fn probe(
        &self,
    ) -> Result<Vec<agent_client_protocol::schema::v1::SessionConfigOption>, String> {
        probe_subprocess(&self.process, MODEL_PROBE_TIMEOUT)
            .await
            .map_err(safe_probe_error)
    }
}

fn safe_probe_error(error: ProbeError) -> String {
    match error {
        ProbeError::Timeout(_) => "the ACP model probe timed out".to_owned(),
        ProbeError::Protocol(_) => "the ACP model probe protocol failed".to_owned(),
        ProbeError::Process(_) => "the ACP model probe process failed".to_owned(),
    }
}
