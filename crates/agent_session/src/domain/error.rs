use crate::domain::model::AgentSessionId;
use agent_runtime_protocol::domain::action::ActionError;
use agent_runtime_protocol::domain::ports::TransportError;
use thiserror::Error;
pub type Result<T, E = AgentSessionError> = std::result::Result<T, E>;

#[derive(Error, Debug)]
pub enum AgentSessionError {
    #[error("agent session {0} already has an active transport")]
    AlreadyConnected(AgentSessionId),
    #[error("agent session {0} is managed by another live replica")]
    ManagedElsewhere(AgentSessionId),
    #[error("agent session {0} write was fenced out: another replica claimed the session")]
    FencedOut(AgentSessionId),
    #[error("acp handshake failed: {0}")]
    Handshake(String),
    #[error("agent session {0} is no longer connected")]
    Disconnected(AgentSessionId),
    #[error("this bot already has a session for this thread")]
    ThreadSessionExists,
    #[error("the session owner is not a known user")]
    UnknownOwner,
    #[error("invalid agent session name: {0}")]
    InvalidName(&'static str),
    #[error("the caller may not control this agent session")]
    Forbidden,
    #[error("no queued action with this id; it may already have been dispatched")]
    QueuedControlNotFound,
    #[error("only queued prompts can be edited")]
    QueuedControlNotEditable,
    #[error("a queued prompt cannot be edited to say nothing; remove it instead")]
    EmptyQueuedPrompt,
    #[error("agent session {0} has too many queued actions")]
    ControlQueueFull(AgentSessionId),
    #[error(
        "agent session {0} cannot be restored because the agent supports neither session/resume nor session/load"
    )]
    ResumeUnsupported(AgentSessionId),
    #[error("agent session {0} action delivery timed out")]
    DeliveryTimedOut(AgentSessionId),
    #[error("agent session {0} log persistence timed out")]
    LogTimedOut(AgentSessionId),
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
