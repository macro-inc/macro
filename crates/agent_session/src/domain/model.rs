use agent_fold::domain::model::FoldedMessage;
use agent_runtime_protocol::domain::schema::v0::SystemEvent;
use bots::domain::models::BotId;
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;

// The log vocabulary - the session id, the log entry, and the frame it
// carries - is owned by `agent_fold`, the bottom of the agent session stack,
// so that this crate can depend on the fold (see `agent_fold::domain::log`).
// Re-exported here because this is where callers expect session types.
pub use agent_fold::domain::log::{AgentSessionId, AgentSessionLog, Message};
// Folded messages are derived, but a `MessageId` is also what a comms
// placeholder persists (inside its `agent_session_message_id`) to say which
// message it renders.
pub use agent_fold::domain::model::{Author, AuthorKind, MessageId, TurnId};

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

/// The composite id a placeholder comms message stores in its
/// `agent_session_message_id` column:
/// `"{agent_session_id}:{turn}:{author}"`.
///
/// Folded messages have no table of their own, so this composite is the whole
/// mapping between a comms row and the message it renders. Comms writes it
/// when placing a placeholder, and readers joining folded messages back onto
/// comms rows reproduce it from the same parts.
///
/// Keyed per message rather than per turn: a turn yields a prompt and a
/// reply with different senders, and each needs its own row.
#[must_use]
pub fn composite_message_id(session: AgentSessionId, id: MessageId) -> String {
    format!("{}:{id}", session.as_uuid())
}

/// The message key inside a [`composite_message_id`] built for `session`, or
/// `None` when the composite names a different session or is malformed.
#[must_use]
pub fn parse_composite_message_id(session: AgentSessionId, composite: &str) -> Option<MessageId> {
    composite
        .strip_prefix(&format!("{}:", session.as_uuid()))?
        .parse()
        .ok()
}

/// A session's folded messages, looked up by its dedicated channel.
#[derive(Debug, Clone)]
pub struct ChannelFoldedMessages {
    /// The session whose log derived the messages.
    pub agent_session_id: AgentSessionId,
    /// The folded messages, oldest first.
    pub messages: Vec<FoldedMessage>,
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
