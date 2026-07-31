//! Domain models and errors for the agent proxy.

use chat::domain::models::{ChatAgentKind, ChatErr, ChatResponse};
use macro_uuid::Uuid;
use models_permissions::share_permission::access_level::AccessLevel;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// A `Result` alias where the error type is [`AgentProxyErr`].
pub type Result<T, E = AgentProxyErr> = std::result::Result<T, E>;

/// Identifies one external agent.
///
/// The same value goes by three names depending on the layer: the `agent_id`
/// of the CRUD API, the `session_id` of the ACP endpoints and this crate's
/// domain, and the chat entity id it is persisted as. They are one id.
/// [`AcpSessionId`] is the one that is genuinely different, and this type
/// exists so the two can never be passed for one another.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct AgentId(Uuid);

impl AgentId {
    /// Wrap a UUID known to identify an agent.
    #[must_use]
    pub fn new(id: Uuid) -> Self {
        Self(id)
    }

    /// Parse an agent id from its string form, as stored by the chat repo.
    pub fn parse(id: &str) -> Result<Self> {
        Ok(id.parse()?)
    }

    /// The underlying UUID, for adapters that must speak in raw ids.
    #[must_use]
    pub fn as_uuid(&self) -> Uuid {
        self.0
    }
}

impl std::fmt::Display for AgentId {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(formatter)
    }
}

impl std::str::FromStr for AgentId {
    type Err = anyhow::Error;

    fn from_str(id: &str) -> std::result::Result<Self, Self::Err> {
        Ok(Self(macro_uuid::string_to_uuid(id)?))
    }
}

/// Identifies the ACP-level session a runtime created via `session/new`.
///
/// Chosen by the runtime, not by us: it does not exist until a connection's
/// ACP handshake completes, it changes when a runtime reconnects, and it is
/// what gets stamped onto an outgoing message's `sessionId` param. Never
/// interchangeable with [`AgentId`] — writing one where the other belongs
/// addresses a message to a session that does not exist.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct AcpSessionId(String);

impl AcpSessionId {
    /// Wrap the session id a runtime reported.
    #[must_use]
    pub fn new(id: impl Into<String>) -> Self {
        Self(id.into())
    }

    /// Borrow the id's string form.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Consume this id, yielding its string form.
    #[must_use]
    pub fn into_string(self) -> String {
        self.0
    }
}

impl std::fmt::Display for AcpSessionId {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(formatter)
    }
}

/// Identifies one row of the pending-message queue.
///
/// A queue row, not an agent: [`crate::domain::ports::PendingMessages`] takes
/// both this and an [`AgentId`], and they were the same raw type until this
/// newtype existed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct PendingMessageId(Uuid);

impl PendingMessageId {
    /// Wrap a UUID known to identify a queued message.
    #[must_use]
    pub fn new(id: Uuid) -> Self {
        Self(id)
    }

    /// The underlying UUID, for adapters that must speak in raw ids.
    #[must_use]
    pub fn as_uuid(&self) -> Uuid {
        self.0
    }
}

impl std::fmt::Display for PendingMessageId {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(formatter)
    }
}

/// Domain error type for agent proxy operations.
#[derive(Debug, thiserror::Error)]
pub enum AgentProxyErr {
    /// The requested agent (chat) was not found.
    #[error("agent not found")]
    NotFound,
    /// The caller is not allowed to perform the operation.
    #[error("unauthorized")]
    Unauthorized,
    /// The request was malformed or targeted the wrong kind of chat.
    #[error("bad request: {0}")]
    BadRequest(String),
    /// The session has no live agent runtime connection to forward to.
    #[error("session is not connected to an agent runtime")]
    SessionNotConnected,
    /// The session's runtime is connected, but the proxy hasn't finished (or
    /// failed to) create its ACP-level session yet.
    #[error("agent runtime's ACP session is not ready yet")]
    AcpSessionNotReady,
    /// An unexpected error occurred.
    #[error(transparent)]
    Unknown(#[from] anyhow::Error),
}

impl From<ChatErr> for AgentProxyErr {
    fn from(err: ChatErr) -> Self {
        match err {
            ChatErr::NotFound => AgentProxyErr::NotFound,
            ChatErr::BadRequest(msg) => AgentProxyErr::BadRequest(msg),
            ChatErr::Access(_) => AgentProxyErr::Unauthorized,
            ChatErr::Unknown(e) => AgentProxyErr::Unknown(e),
        }
    }
}

/// Arguments for creating a new agent.
#[derive(Debug)]
pub struct CreateAgentArgs {
    /// The name of the agent.
    pub name: String,
    /// The project to associate the agent with.
    pub project_id: Option<String>,
    /// What kind of agent to create: `Macro` or `External`.
    pub kind: ChatAgentKind,
}

/// Arguments for patching an agent.
#[derive(Debug)]
pub struct PatchAgentArgs {
    /// New name for the agent, if changing.
    pub name: Option<String>,
    /// New project ID for the agent, if moving. Empty string clears the
    /// project.
    pub project_id: Option<String>,
}

/// An agent with its full chat data, mirroring the DCS get-chat response
/// shape plus the agent kind.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GetAgentResponse {
    /// The full chat data backing the agent.
    pub chat: ChatResponse,
    /// What kind of agent backs the chat.
    pub kind: ChatAgentKind,
    /// The requesting user's access level on this agent.
    pub user_access_level: AccessLevel,
}
