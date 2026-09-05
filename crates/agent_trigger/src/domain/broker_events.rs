//! Signals published to [`MacroAgentSessionsTopic`].

use agent_session::domain::model::AgentSessionId;
use bot_id::BotId;
use channels::domain::broker_events::ChannelMessagePostedMetadata;
use macro_event_broker::{Event, MacroEvent, TopicEvent};
use macro_event_topics::MacroAgentSessionsTopic;
use serde::{Deserialize, Serialize};

#[cfg(test)]
mod test;

/// How a message was attributed to the session it feeds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChannelKind {
    /// The thread the session was created from, where the bot was pinged.
    MentionThread,
    /// The session's thread, where the message explicitly targeted another
    /// message without a mention.
    ExplicitReply,
    /// The session's thread, where a model inferred the message was addressed
    /// to the agent.
    Inferred,
}

/// A session opened by a mention in a channel.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentBotMentionedEvent {
    /// The bot that was mentioned.
    pub bot_id: BotId,
    /// The message that triggered this, verbatim.
    pub message: ChannelMessagePostedMetadata,
}

/// Events that open a new session.
#[non_exhaustive]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "source", rename_all = "snake_case")]
pub enum NewAgentSessionEvent {
    /// Opened by a bot mention in a top-level channel message.
    TopLevelMentioned(AgentBotMentionedEvent),
}

/// A message for a session that already exists.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChannelEventMetadata {
    /// Whose session this is, so foreign traffic is dropped before any read.
    pub bot_id: BotId,
    /// The session to feed.
    pub session_id: AgentSessionId,
    /// How the message was attributed to the session.
    pub kind: ChannelKind,
    /// The message, verbatim.
    pub message: ChannelMessagePostedMetadata,
}

/// Events for a session that already exists.
#[non_exhaustive]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "source", rename_all = "snake_case")]
pub enum ExistingAgentSessionEvent {
    /// A mentioned message arrived in the session's originating thread.
    Channel(ChannelEventMetadata),
}

/// Events publishable to [`MacroAgentSessionsTopic`].
///
/// The serde tag and [`AgentTriggerEventName`] spell the same wire names:
/// subscribers filter on them, so they are API. `event_names_match_the_wire`
/// holds the two in step.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, strum::EnumDiscriminants)]
#[serde(tag = "event_type", content = "metadata")]
#[strum_discriminants(
    name(AgentTriggerEventName),
    derive(strum::Display, strum::EnumIter, strum::IntoStaticStr),
    doc = "The wire name of an [`AgentTriggerTopicEvent`], as subscribers filter on it."
)]
pub enum AgentTriggerTopicEvent {
    /// Open a session.
    #[serde(rename = "agent_trigger.new")]
    #[strum_discriminants(strum(serialize = "agent_trigger.new"))]
    New(NewAgentSessionEvent),
    /// Feed a session that already exists.
    #[serde(rename = "agent_trigger.existing")]
    #[strum_discriminants(strum(serialize = "agent_trigger.existing"))]
    Existing(ExistingAgentSessionEvent),
}

impl TopicEvent for AgentTriggerTopicEvent {
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
    event: Event<AgentTriggerTopicEvent>,
}

impl AgentSessionMacroEvent {
    /// Open a session for a bot.
    #[must_use]
    pub fn new_session(event: NewAgentSessionEvent) -> Self {
        let bot_id = match &event {
            NewAgentSessionEvent::TopLevelMentioned(mentioned) => mentioned.bot_id,
        };
        Self::new(bot_id, AgentTriggerTopicEvent::New(event))
    }

    /// Feed one of a bot's existing sessions.
    #[must_use]
    pub fn channel_event(metadata: ChannelEventMetadata) -> Self {
        let bot_id = metadata.bot_id;
        Self::existing_event(ExistingAgentSessionEvent::Channel(metadata), bot_id)
    }

    /// Feed one of a bot's existing sessions, however the message arrived.
    #[must_use]
    pub fn existing_event(event: ExistingAgentSessionEvent, bot_id: BotId) -> Self {
        Self::new(bot_id, AgentTriggerTopicEvent::Existing(event))
    }

    fn new(bot_id: BotId, event: AgentTriggerTopicEvent) -> Self {
        Self {
            key: bot_id.to_string(),
            event: Event::new(event),
        }
    }

    fn with_event(key: String, event: Event<AgentTriggerTopicEvent>) -> Self {
        Self { key, event }
    }
}

impl MacroEvent for AgentSessionMacroEvent {
    type EventPayload = AgentTriggerTopicEvent;

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
