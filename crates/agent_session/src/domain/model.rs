use agent_runtime_protocol::domain::schema::v0::{SystemEvent, ToRuntimeMessage, ToServerMessage};
use bots::domain::models::BotId;
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct AgentSessionId(Uuid);

impl AgentSessionId {
    #[cfg(any(test, feature = "test-utils"))]
    pub const TEST_A: Self = Self(Uuid::from_u128(0xA));

    #[cfg(any(test, feature = "test-utils"))]
    pub const TEST_B: Self = Self(Uuid::from_u128(0xB));

    /// Mint a fresh session id, backed by a UUIDv7.
    #[expect(clippy::new_without_default, reason = "each call mints a distinct id")]
    pub fn new() -> Self {
        Self(macro_uuid::generate_uuid_v7())
    }

    pub(crate) fn new_from_uuid(id: Uuid) -> Self {
        Self(id)
    }

    /// The underlying UUID.
    pub fn as_uuid(&self) -> Uuid {
        self.0
    }
}

impl std::fmt::Display for AgentSessionId {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(formatter)
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
pub struct AgentSession {
    /// id of the agent session
    pub id: AgentSessionId,
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

/// One bot's session, and how the thread of an incoming channel message
/// relates to it.
///
/// A session is scoped to one bot in one thread, and a message can relate to
/// it two different ways: posted in the thread the session was *created from*,
/// or posted inside the session's own thread. Callers act differently on each,
/// so one lookup answers both rather than making them ask twice.
#[derive(Debug, Clone)]
pub enum ThreadSession {
    /// No session for this bot in this thread.
    None,
    /// The bot's session, created from the thread the message is in.
    CreatedFromThisThread(AgentSession),
    /// The message arrived inside the session's own thread.
    InSessionThread(AgentSession),
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
