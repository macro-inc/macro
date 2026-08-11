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
// placeholder's agent_session_turn/agent_session_author columns persist to
// say which message it renders - see PgAgentSessionRepo's `Comms` impl.
pub use agent_fold::domain::model::{Author, AuthorKind, FoldedMessage, MessageId, TurnId};

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

/// One folded message a live session's frame just derived or changed, for
/// anyone watching.
///
/// The streaming counterpart of [`ChannelFoldedMessages`]: that is every
/// message for a reader arriving late, this is the one message a frame
/// changed for a reader already here. Both carry whole messages rather than
/// deltas, so a reader applies either the same way - replace whatever it
/// holds under the message's id.
///
/// Addressed by channel rather than by session because that is what a viewer
/// has: they opened a channel, and may not know a session exists.
#[derive(Debug, Clone)]
pub struct FoldedMessagePublished {
    /// The channel whose viewers should see this.
    pub channel_id: Uuid,
    /// The session the message was folded from - half of the composite id
    /// that joins it to the placeholder row rendering it.
    pub agent_session_id: AgentSessionId,
    /// Whether the frame derived the message or extended one already
    /// reported. `New` is the one moment a viewer can learn a row for this
    /// message is about to exist.
    pub change: FoldedMessageChange,
    /// How many log frames the fold had consumed when it produced this, the
    /// last one included. A reader who fetched the messages of a log
    /// `log_length` frames long already holds everything an event with
    /// `log_index <= log_length` says.
    pub log_index: u64,
    /// The message as it now stands.
    pub message: FoldedMessage,
}

/// Whether a published folded message is new or an update to one already
/// published.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FoldedMessageChange {
    /// The frame derived a message the fold had not reported before.
    New,
    /// The frame changed a message the fold had already reported.
    Updated,
}

/// A session's folded messages, looked up by its dedicated channel.
#[derive(Debug, Clone)]
pub struct ChannelFoldedMessages {
    /// The session whose log derived the messages.
    pub agent_session_id: AgentSessionId,
    /// The agent whose messages these are.
    ///
    /// Sent because a reader has to render those messages and cannot work out
    /// who sent them: the sender of an agent message is this session's bot,
    /// and nothing else a client fetches names it. Asking the channel's bots
    /// is the wrong question - those are bots explicitly added to a channel,
    /// which a session's agent need not be.
    pub bot: SessionBot,
    /// How many log frames the messages were folded from. The realtime
    /// counterpart ([`FoldedMessagePublished::log_index`]) carries the same
    /// counter, which is what lets a reader align a fetched snapshot with a
    /// live stream without comparing content.
    pub log_length: u64,
    /// The session's folded messages, oldest first.
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
