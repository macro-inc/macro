use agent_runtime_protocol::domain::schema::v0::{SystemEvent, ToRuntimeMessage, ToServerMessage};
use bots::domain::models::BotId;
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use serde::{Deserialize, Serialize};

pub struct UninitializedSession;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct AgentSessionId(Uuid);

impl AgentSessionId {
    /// Wrap an existing UUID as an agent session id.
    pub fn new_from_uuid(id: Uuid) -> Self {
        Self(id)
    }

    /// The underlying UUID.
    pub fn as_uuid(&self) -> Uuid {
        self.0
    }
}

#[derive(Debug, Clone, Default)]
pub enum SessionStatus {
    /// No status updates received
    #[default]
    NoMessages,
    /// EventRecieved from container
    Event(SystemEvent),
    /// A session disconnected without sending a clsoed event
    Disconnected,
}

/// A running or historical agent coding session.
#[derive(Debug, Clone)]
pub struct AgentSession<SessionId> {
    /// id of the agent session
    pub id: SessionId,
    /// if this was created by `@` in a thread
    pub created_from_thread_id: Option<Uuid>,
    /// the thread id of the comms thread
    pub thread_id: Uuid,
    /// the bot id of the bot running the agent
    pub bot_id: BotId,
    /// model slug - TODO: probably a better type here
    pub model: String,
    /// harness slug - TODO: probably a better type here
    pub harness: String,
    /// repo we are working with
    pub repo_url: String,
    /// ACP session if we have one
    pub acp_session_id: Option<String>,
    pub status: SessionStatus,
    pub created_at: DateTime<Utc>,
    pub modified_at: DateTime<Utc>,
}

/// One logical protocol message with its direction.
///
/// Serializes as `{"direction": "to_server" | "to_runtime", "content": <envelope>}`,
/// the same vocabulary the Postgres log storage uses for its `direction` and
/// `content` columns, so recorded fixtures and stored rows share one wire
/// format.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "direction", content = "content", rename_all = "snake_case")]
pub enum Message {
    ToServer(ToServerMessage),
    ToRuntime(ToRuntimeMessage),
}

#[derive(Debug, Clone)]
pub struct AgentSessionLog {
    pub agent_session_id: AgentSessionId,
    /// if this is ACP sent by a user this will be Some
    pub user_id: Option<MacroUserIdStr<'static>>,
    pub content: Message,
}
