//! Signals published to [`MacroAgentSessionsTopic`].

use agent_session::domain::model::AgentSessionId;
use bot_id::BotId;
use channels::domain::broker_events::ChannelMessagePostedMetadata;
use macro_event_broker::{Event, MacroEvent, TopicEvent};
use macro_event_topics::MacroAgentSessionsTopic;
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};

/// Which of a session's two surfaces a message arrived on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChannelKind {
    /// The session's dedicated channel, where every message is for the agent.
    DedicatedChannel,
    /// The thread the session was created from, where the bot was pinged.
    MentionThread,
}

/// A session opened by a mention in a channel.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentBotMentionedEvent {
    /// The bot that was mentioned.
    pub bot_id: BotId,
    /// The message that triggered this, verbatim.
    pub message: ChannelMessagePostedMetadata,
}

/// A session opened directly, so there is no channel message and no mention
/// thread - only the orphaned thread the session mints for itself.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DirectAgentSpawnEvent {
    /// The bot to run.
    pub bot_id: BotId,
    /// Who asked for it.
    pub requested_by: MacroUserIdStr<'static>,
    /// What to tell the agent first, if anything.
    pub prompt: Option<String>,
}

/// Why a session should be opened.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "source", rename_all = "snake_case")]
pub enum NewSessionMetadata {
    /// Opened by a mention in a channel.
    Mentioned(AgentBotMentionedEvent),
    /// Opened directly by a user.
    Direct(DirectAgentSpawnEvent),
}

/// A message for a session that already exists.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChannelEventMetadata {
    /// Whose session this is, so foreign traffic is dropped before any read.
    pub bot_id: BotId,
    /// The session to feed.
    pub session_id: AgentSessionId,
    /// Which surface it arrived on.
    pub kind: ChannelKind,
    /// The message, verbatim.
    pub message: ChannelMessagePostedMetadata,
}

/// Events publishable to [`MacroAgentSessionsTopic`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "event_type", content = "metadata")]
pub enum AgentSessionTopicEvent {
    /// Open a session.
    #[serde(rename = "agent_session.new")]
    New(NewSessionMetadata),
    /// Feed a session that already exists.
    #[serde(rename = "agent_session.channel_event")]
    ChannelEvent(ChannelEventMetadata),
}

impl TopicEvent for AgentSessionTopicEvent {
    type Topic = MacroAgentSessionsTopic;

    const SCHEMA_VERSION: u8 = 1;
}

/// Publishable event for [`MacroAgentSessionsTopic`].
///
/// Keyed by bot id: a session belongs to one bot, so one bot's partition
/// carries every event of every one of its sessions, in order -- which is what
/// lets the harness instance owning that partition keep the live sessions in
/// memory.
#[derive(Debug, Clone)]
pub struct AgentSessionMacroEvent {
    key: String,
    event: Event<AgentSessionTopicEvent>,
}

impl AgentSessionMacroEvent {
    /// Open a session for a bot.
    #[must_use]
    pub fn new_session(metadata: NewSessionMetadata) -> Self {
        let bot_id = match &metadata {
            NewSessionMetadata::Mentioned(mentioned) => mentioned.bot_id,
            NewSessionMetadata::Direct(direct) => direct.bot_id,
        };
        Self::new(bot_id, AgentSessionTopicEvent::New(metadata))
    }

    /// Feed one of a bot's existing sessions.
    #[must_use]
    pub fn channel_event(metadata: ChannelEventMetadata) -> Self {
        let bot_id = metadata.bot_id;
        Self::new(bot_id, AgentSessionTopicEvent::ChannelEvent(metadata))
    }

    fn new(bot_id: BotId, event: AgentSessionTopicEvent) -> Self {
        Self {
            key: bot_id.to_string(),
            event: Event::new(event),
        }
    }

    fn with_event(key: String, event: Event<AgentSessionTopicEvent>) -> Self {
        Self { key, event }
    }
}

impl MacroEvent for AgentSessionMacroEvent {
    type EventPayload = AgentSessionTopicEvent;

    fn key(&self) -> &str {
        &self.key
    }

    fn event(&self) -> &Event<Self::EventPayload> {
        &self.event
    }

    fn from_event(key: String, event: Event<Self::EventPayload>) -> Self {
        Self::with_event(key, event)
    }
}
