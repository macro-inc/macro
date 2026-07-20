//! Domain models and errors for the agent proxy.

use chat::domain::models::{ChatAgentKind, ChatErr, ChatResponse};
use models_permissions::share_permission::access_level::AccessLevel;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// A `Result` alias where the error type is [`AgentProxyErr`].
pub type Result<T, E = AgentProxyErr> = std::result::Result<T, E>;

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
