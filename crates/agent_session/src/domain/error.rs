use crate::domain::model::AgentSessionId;
use agent_runtime_protocol::domain::action::ActionError;
use agent_runtime_protocol::domain::ports::TransportError;
use model_owner::OwnerType;
use thiserror::Error;
pub type Result<T, E = AgentSessionError> = std::result::Result<T, E>;

#[derive(Error, Debug)]
pub enum AgentSessionError {
    /// Invalid link or channel sharing input.
    #[error("{0}")]
    InvalidSharing(&'static str),
    /// Explicit owner-team sharing was rejected by the shared policy.
    #[error(transparent)]
    TeamSharing(models_permissions::share_permission::team_share::TeamSharePolicyError),
    /// Sharing facts changed while an owner update was in flight.
    #[error("sharing changed; reload and try again")]
    SharingChanged,
    /// A repository or branch cannot be used by this session.
    #[error("{0}")]
    InvalidRepositorySelection(&'static str),
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
    /// A create named an id a session already holds. Ids are minted by the
    /// client so a surface can open on the final id before the create
    /// answers; two creates under one id is a client bug, not a retry.
    #[error("agent session {0} already exists")]
    SessionIdTaken(AgentSessionId),
    #[error("the session owner is not a known user")]
    UnknownOwner,
    /// A path that runs as the session's owner - spending their credentials,
    /// attributing work to them, granting them access - met an owner that is
    /// not a user. Every session is user-owned today; this is the boundary
    /// that says so out loud instead of assuming it.
    #[error("this path needs a user-owned session, but the owner is a {0}")]
    OwnerNotUser(OwnerType),
    #[error("expected a GitHub PR URL: https://github.com/owner/repo/pull/number")]
    InvalidPullRequestUrl,
    #[error("invalid agent session name: {0}")]
    InvalidName(&'static str),
    #[error("a preview request may name at most {0} sessions")]
    TooManyPreviewIds(usize),
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
        "agent session {0} has no open permission request with this id; it may already have been answered or cancelled"
    )]
    PermissionRequestNotFound(AgentSessionId),
    #[error("agent session {0} was not offered that permission option")]
    PermissionOptionUnknown(AgentSessionId),
    #[error(
        "agent session {0} cannot be restored because the agent supports neither session/resume nor session/load"
    )]
    ResumeUnsupported(AgentSessionId),
    /// The answer names an elicitation the live connection is not holding:
    /// already answered, cancelled by a stop, lost with the connection, or
    /// never asked.
    #[error("agent session {0} has no pending elicitation matching that request id")]
    ElicitationNotPending(AgentSessionId),
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
