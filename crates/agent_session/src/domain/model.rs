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
// placeholder's identifier persists to say which message it renders - see
// PgAgentSessionRepo's `Comms` impl.
pub use agent_fold::domain::model::{
    Author, AuthorKind, IncrementalFoldResult, MessageId, OwnedIncrementalFoldResult, TurnId,
};

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

/// The agent behind a session, as much of it as rendering a message needs.
#[derive(Debug, Clone)]
pub struct SessionBot {
    /// The bot's id. A message it sent has `"bot|{id}"` as its sender.
    pub id: BotId,
    /// Display name.
    pub name: String,
    /// Avatar, when it has one.
    pub avatar_url: Option<String>,
}

/// One frame appended to a live session's log, for anyone watching.
///
/// The streaming counterpart of [`ChannelSessionLog`]: that is the whole log
/// for a reader arriving late, this is one frame for a reader already here.
/// Both carry the same entry shape, so a client folds them the same way -
/// catching up on the log and then following it is one fold, not two.
///
/// Addressed by channel rather than by session because that is what a viewer
/// has: they opened a channel, and may not know a session exists.
#[derive(Debug, Clone)]
pub struct LogAppended {
    /// The channel whose viewers should see this.
    pub channel_id: Uuid,
    /// The session the entry belongs to. The fold keys its messages on this,
    /// so a client must pass it through unchanged.
    pub agent_session_id: AgentSessionId,
    /// The frame, exactly as the log stored it.
    pub entry: AgentSessionLog,
}

/// A session's raw protocol log, looked up by its dedicated channel.
///
/// Served rather than the messages it derives: the reader folds it. The web
/// client runs the same fold compiled to WASM, so a streamed session and a
/// reloaded one are rendered by one implementation rather than two that have
/// to be kept agreeing.
#[derive(Debug, Clone)]
pub struct ChannelSessionLog {
    /// The session the entries belong to.
    pub agent_session_id: AgentSessionId,
    /// The agent whose messages the log derives.
    ///
    /// Sent because a reader has to render those messages and cannot work out
    /// who sent them: the sender of an agent message is this session's bot,
    /// and nothing else a client fetches names it. Asking the channel's bots
    /// is the wrong question - those are bots explicitly added to a channel,
    /// which a session's agent need not be.
    pub bot: SessionBot,
    /// Every logged frame, oldest first. Folding depends on this order.
    pub entries: Vec<AgentSessionLog>,
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
