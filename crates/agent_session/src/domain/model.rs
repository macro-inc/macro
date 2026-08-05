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

#[derive(Debug, Clone, Default, strum::AsRefStr)]
#[strum(serialize_all = "snake_case")]
pub enum SessionStatus {
    /// No status updates received.
    #[default]
    NoMessages,
    /// The latest status received from the container.
    Event(SystemEvent),
    /// The session disconnected without sending a closed event.
    Disconnected,
}

/// Caller-provided values required to create an agent session.
#[derive(Debug, Clone)]
pub struct CreateAgentSessionParams {
    /// Caller-minted session id, available before persistence.
    pub id: AgentSessionId,
    /// User who owns the dedicated agent channel.
    pub owner_id: MacroUserIdStr<'static>,
    /// Bot running the agent.
    pub bot_id: BotId,
    /// Root message identifying the originating thread, if any.
    pub thread_id: Option<Uuid>,
    /// Exact message that invoked the bot, if any.
    pub originating_message_id: Option<Uuid>,
    /// Model slug.
    pub model: String,
    /// Harness slug.
    pub harness: String,
    /// Repository the agent works with.
    pub repo_url: String,
}

/// A running or historical agent coding session.
#[derive(Debug, Clone)]
pub struct AgentSession {
    /// id of the agent session
    pub id: AgentSessionId,
    /// The dedicated channel created for this session.
    pub channel_id: Uuid,
    /// The root message where the bot was originally invoked, if any.
    pub thread_id: Option<Uuid>,
    /// The exact message that originally invoked the bot, if any.
    pub originating_message_id: Option<Uuid>,
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

/// How an incoming channel context relates to an agent session.
#[derive(Debug, Clone)]
pub enum ChannelSession {
    /// No session matched the channel context.
    None,
    /// The bot's session was created from the incoming thread.
    CreatedFromThread(AgentSession),
    /// The message arrived in the session's dedicated agent channel.
    InDedicatedChannel(AgentSession),
    /// A bot was addressed from a thread inside a dedicated agent channel.
    ///
    /// This means that:
    /// - You are in a dedicated agent channel
    /// - The message is in a thread
    /// - The bot is mentioned in the thread
    ThreadInDedicatedChannel {
        /// Session that owns the dedicated channel.
        dedicated_channel_agent_session: AgentSession,
        /// Session associated with the addressed bot and thread.
        subthread_agent_session: AgentSession,
    },
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
