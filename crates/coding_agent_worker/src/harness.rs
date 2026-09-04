//! The harness child process and the bridge between its stdio and the
//! gateway channel.

use std::path::Path;
use std::time::Duration;

use crate::config::Harness;
use crate::outbound::acp_probe::{ProbeError, ProbeSubprocess, probe_subprocess};
use agent_client_protocol::{AcpAgent, AcpAgentConfig, Client, ConnectTo};
use agent_fold::domain::model_selection::model_selection;
use agent_runtime_protocol::domain::connection::{
    ConnectionError, ModelProbeHandler, RuntimeChannel, RuntimeConnection,
};
use agent_runtime_protocol::domain::schema::v0::SystemEvent;
use harnesses::domain::models::{PairingModelCatalog, PairingModelOption};

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

/// Spawn the harness in ACP mode and pump frames until either side ends.
pub async fn bridge(
    harness: &Harness,
    cwd: &Path,
    channel: RuntimeChannel,
) -> Result<(), BridgeError> {
    let probes = HarnessModelProbes {
        process: probe_process(harness, cwd),
    };
    let (runtime, acp) = RuntimeConnection::connect_with_model_probe_handler(channel, probes);

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

/// Discover the configured harness's model catalog before it is registered.
pub(crate) async fn discover_model_catalog(
    harness: &Harness,
    cwd: &Path,
) -> Result<Option<PairingModelCatalog>, String> {
    let options = probe_subprocess(&probe_process(harness, cwd), MODEL_PROBE_TIMEOUT)
        .await
        .map_err(safe_probe_error)?;
    Ok(pairing_model_catalog(&options))
}

fn probe_process(harness: &Harness, cwd: &Path) -> ProbeSubprocess {
    ProbeSubprocess {
        command: harness.command.clone().into(),
        args: harness.args.clone(),
        cwd: cwd.to_owned(),
    }
}

fn pairing_model_catalog(
    options: &[agent_client_protocol::schema::v1::SessionConfigOption],
) -> Option<PairingModelCatalog> {
    model_selection(options).map(|selection| PairingModelCatalog {
        current: selection.current,
        options: selection
            .options
            .into_iter()
            .map(|option| PairingModelOption {
                id: option.id,
                name: option.name,
                description: option.description,
                group: option.group,
            })
            .collect(),
    })
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
        #[cfg(not(unix))]
        ProbeError::UnsupportedWorkingDirectory => {
            "the ACP model probe cannot apply the configured working directory".to_owned()
        }
        ProbeError::Protocol(_) => "the ACP model probe protocol failed".to_owned(),
        ProbeError::Process(_) => "the ACP model probe process failed".to_owned(),
    }
}
