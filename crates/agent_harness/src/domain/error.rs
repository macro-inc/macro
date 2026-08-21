//! Harness domain errors.

use agent_runtime_protocol::domain::action::ActionError;
use agent_runtime_protocol::domain::ports::TransportError;
use agent_session::domain::error::AgentSessionError;
use agent_session::domain::model::AgentSessionId;

/// A `Result` whose error is a [`HarnessError`].
pub type Result<T, E = HarnessError> = std::result::Result<T, E>;

/// A failure while provisioning or running an agent session.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum HarnessError {
    /// A container could not be spawned or reattached.
    #[error("container unavailable: {0}")]
    Container(String),
    /// The agent would not open an ACP session.
    #[error("acp handshake failed: {0}")]
    Handshake(String),
    /// The session has no container to talk to any more.
    #[error("agent session {0} is no longer connected")]
    Disconnected(AgentSessionId),
    /// The session's transport failed.
    #[error(transparent)]
    Transport(#[from] TransportError),
    /// An action could not be expressed as ACP.
    #[error(transparent)]
    Action(#[from] ActionError),
    /// Building or reading an ACP message failed.
    #[error(transparent)]
    Acp(#[from] agent_client_protocol::Error),
    /// Reading or writing the session's persistent state failed.
    #[error(transparent)]
    Session(#[from] AgentSessionError),
    /// A session command worker stopped before reporting its result.
    #[error("agent session {0} command worker stopped")]
    CommandWorkerStopped(AgentSessionId),
    /// The session link could not be posted back to the mention's thread.
    #[error("failed to announce the agent session: {0}")]
    Announce(rootcause::Report),
}
