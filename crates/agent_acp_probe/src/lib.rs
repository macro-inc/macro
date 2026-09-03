//! Bounded, prompt-free discovery of an ACP agent's session configuration.

#![deny(missing_docs)]

use std::path::{Path, PathBuf};
use std::time::Duration;

use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::schema::v1::{
    InitializeRequest, NewSessionRequest, SessionConfigOption,
};
use agent_client_protocol::{AcpAgent, AcpAgentConfig, Agent, Channel, Client, ConnectionTo};

#[cfg(test)]
mod test;

/// A subprocess launch description for one isolated ACP probe.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProbeSubprocess {
    /// Executable or command name.
    pub command: PathBuf,
    /// Arguments passed to the executable.
    pub args: Vec<String>,
    /// Directory in which the executable runs.
    pub cwd: PathBuf,
}

/// A failure to discover an ACP agent's session configuration.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum ProbeError {
    /// The initialize or session/new exchange failed.
    #[error("ACP model probe failed: {0}")]
    Protocol(String),
    /// The configured process stopped before the probe completed.
    #[error("ACP model probe process stopped: {0}")]
    Process(String),
    /// The bounded probe did not complete in time.
    #[error("ACP model probe timed out after {0:?}")]
    Timeout(Duration),
    /// This platform cannot apply a subprocess working directory while
    /// retaining `AcpAgent`'s process-group cleanup.
    #[error("ACP model probe working directories are unsupported on this platform")]
    UnsupportedWorkingDirectory,
}

/// Run `initialize` followed by `session/new` over an already-connected ACP
/// channel and return the new session's raw configuration options.
///
/// No prompt is sent. Dropping this future drops the ACP client connection.
pub async fn probe_channel(
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
///
/// On Unix the working directory is applied by a small `/bin/sh` wrapper
/// which immediately `exec`s the configured command. The wrapper and agent
/// remain in the process group guarded by [`AcpAgent`].
pub async fn probe_subprocess(
    process: &ProbeSubprocess,
    deadline: Duration,
) -> Result<Vec<SessionConfigOption>, ProbeError> {
    let agent = subprocess_agent(process)?;
    let (channel, connection) =
        agent_client_protocol::ConnectTo::<Client>::into_channel_and_future(agent);
    let connection = std::pin::pin!(connection);
    let probe = std::pin::pin!(probe_channel(channel, &process.cwd, deadline));

    tokio::select! {
        result = probe => result,
        result = connection => match result {
            Ok(()) => Err(ProbeError::Process("process exited before responding".to_owned())),
            Err(error) => Err(ProbeError::Process(error.to_string())),
        },
    }
}

#[cfg(unix)]
fn subprocess_agent(process: &ProbeSubprocess) -> Result<AcpAgent, ProbeError> {
    // `$0` is a label, `$1` is cwd, and the remaining positional arguments
    // are the configured command and its arguments. No configured value is
    // interpolated into shell source.
    let mut args = vec![
        "-c".to_owned(),
        "cd -- \"$1\" && shift && exec \"$@\"".to_owned(),
        "acp-model-probe".to_owned(),
        process.cwd.to_string_lossy().into_owned(),
        process.command.to_string_lossy().into_owned(),
    ];
    args.extend(process.args.iter().cloned());
    Ok(AcpAgent::new(AcpAgentConfig::new("/bin/sh").args(args)))
}

#[cfg(not(unix))]
fn subprocess_agent(_process: &ProbeSubprocess) -> Result<AcpAgent, ProbeError> {
    Err(ProbeError::UnsupportedWorkingDirectory)
}
