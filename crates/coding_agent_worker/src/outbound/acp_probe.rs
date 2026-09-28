//! Prompt-free inspection of a configured ACP subprocess.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::time::Duration;

use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::schema::v1::{
    InitializeRequest, NewSessionRequest, SessionConfigOption,
};
use agent_client_protocol::{Agent, Channel, Client, ConnectionTo};

use crate::outbound::acp_process::AcpProcess;

#[cfg(test)]
mod test;

/// A subprocess launch description for one isolated ACP probe.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ProbeSubprocess {
    /// Executable or command name.
    pub(crate) command: PathBuf,
    /// Arguments passed to the executable.
    pub(crate) args: Vec<String>,
    /// Directory in which the executable runs.
    pub(crate) cwd: PathBuf,
    /// Environment added on top of this process's own: the same variables
    /// the bridge applies, so the probe inspects the harness that will run.
    pub(crate) env: BTreeMap<String, String>,
}

/// A failure to discover an ACP agent's session configuration.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub(crate) enum ProbeError {
    /// The initialize or session/new exchange failed.
    #[error("ACP model probe failed: {0}")]
    Protocol(String),
    /// The configured process stopped before the probe completed.
    #[error("ACP model probe process stopped: {0}")]
    Process(String),
    /// The bounded probe did not complete in time.
    #[error("ACP model probe timed out after {0:?}")]
    Timeout(Duration),
}

/// Run `initialize` followed by `session/new` over an already-connected ACP
/// channel and return the new session's raw configuration options.
///
/// No prompt is sent. Dropping this future drops the ACP client connection.
async fn probe_channel(
    channel: Channel,
    cwd: &Path,
    deadline: Duration,
) -> Result<Vec<SessionConfigOption>, ProbeError> {
    let cwd = cwd.to_string_lossy().into_owned();
    let exchange = Client.connect_with(channel, async move |connection: ConnectionTo<Agent>| {
        connection
            .send_request(InitializeRequest::new(ProtocolVersion::V1))
            .block_task()
            .await?;
        let opened = connection
            .send_request(NewSessionRequest::new(cwd))
            .block_task()
            .await?;
        Ok(opened.config_options.unwrap_or_default())
    });

    tokio::time::timeout(deadline, exchange)
        .await
        .map_err(|_| ProbeError::Timeout(deadline))?
        .map_err(|error| ProbeError::Protocol(error.to_string()))
}

/// Spawn one configured ACP agent, perform a prompt-free model probe, and
/// tear down that exact child connection before returning.
pub(crate) async fn probe_subprocess(
    process: &ProbeSubprocess,
    deadline: Duration,
) -> Result<Vec<SessionConfigOption>, ProbeError> {
    let expires = tokio::time::Instant::now() + deadline;
    let agent = AcpProcess::new(&process.command, process.args.clone(), &process.cwd)
        .envs(process.env.clone());
    let (channel, connection) =
        agent_client_protocol::ConnectTo::<Client>::into_channel_and_future(agent);
    let mut connection = std::pin::pin!(connection);
    let probe = std::pin::pin!(probe_channel(channel, &process.cwd, deadline));

    tokio::select! {
        // Prefer an already-observed child exit over its resulting ACP error.
        biased;
        result = &mut connection => match result {
            Ok(()) => Err(ProbeError::Process("process exited before responding".to_owned())),
            Err(error) => Err(ProbeError::Process(error.to_string())),
        },
        result = probe => {
            if matches!(result, Err(ProbeError::Protocol(_))) {
                // Stdio can close before the child-exit monitor resolves. Let
                // the supervisor finish shutdown and collect the exit status
                // before classifying the failure, within the original deadline.
                if let Ok(Err(error)) = tokio::time::timeout_at(expires, connection).await {
                    return Err(ProbeError::Process(error.to_string()));
                }
            }
            result
        },
    }
}
