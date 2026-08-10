use crate::domain::model::AgentSessionId;
use agent_runtime_protocol::domain::action::ActionError;
use agent_runtime_protocol::domain::ports::TransportError;
use thiserror::Error;
pub type Result<T, E = AgentSessionError> = std::result::Result<T, E>;

#[derive(Error, Debug)]
pub enum AgentSessionError {
    #[error("agent session {0} already has an active transport")]
    AlreadyConnected(AgentSessionId),
    #[error("acp handshake failed: {0}")]
    Handshake(String),
    #[error("agent session {0} is no longer connected")]
    Disconnected(AgentSessionId),
    #[error(
        "agent session {0} cannot be restored because the agent supports neither session/resume nor session/load"
    )]
    ResumeUnsupported(AgentSessionId),
    #[error(transparent)]
    Transport(#[from] TransportError),
    #[error(transparent)]
    Action(#[from] ActionError),
    #[error(transparent)]
    Acp(#[from] agent_client_protocol::Error),
    #[error("{0}")]
    Unknown(#[from] anyhow::Error),
    /// A fold or comms step failed while keeping a session's channel in step
    /// with its log.
    #[error("{0}")]
    Fold(rootcause::Report),
}

impl From<rootcause::Report> for AgentSessionError {
    fn from(report: rootcause::Report) -> Self {
        Self::Fold(report)
    }
}
