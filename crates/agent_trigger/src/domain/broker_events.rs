//! Signals published to [`MacroAgentSessionsTopic`].
//!
//! The topic stays at its first schema version. Channel parents keep the
//! shapes every consumer already decodes - [`NewAgentSessionEvent::TopLevelMentioned`]
//! and [`ExistingAgentSessionEvent::Channel`], each embedding the channel-only
//! post - because some consumers are user-run daemons that cannot be rolled
//! with a deploy. Other parents travel in the parent-aware variants added
//! beside them, which those consumers drop as unknown: only the new surface
//! waits for them to roll, never a channel mention.

use agent_session::domain::model::AgentSessionId;
use bot_id::BotId;
use channels::domain::broker_events::{ChannelEventAttachment, ChannelMessagePostedMetadata};
use channels::domain::models::ChannelType;
use macro_event_broker::{Event, MacroEvent, TopicEvent};
use macro_event_topics::MacroAgentSessionsTopic;
use macro_uuid::Uuid;
use messages::domain::events::{MessageEventAttachment, MessagePostedMetadata};
use messages::domain::models::MessageParent;
use serde::{Deserialize, Serialize};

#[cfg(test)]
mod test;

/// How a message was attributed to the session it feeds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ThreadMessageKind {
    /// The thread the session was created from, where the bot was pinged.
    MentionThread,
    /// The session's thread, where the message explicitly targeted another
    /// message without a mention.
    ExplicitReply,
    /// The session's thread, where a model inferred the message was addressed
    /// to the agent.
    Inferred,
}

/// A session opened by a mention in a top-level channel message, in the
/// channel-only shape consumers built before message parents decode.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentBotMentionedEvent {
    /// The bot that was mentioned.
    pub bot_id: BotId,
    /// The message that triggered this, verbatim.
    pub message: ChannelMessagePostedMetadata,
}

/// A session opened by a mention on a message parent. Today only document
/// discussions produce it; channel mentions stay on
/// [`NewAgentSessionEvent::TopLevelMentioned`] until every consumer that
/// predates parents has rolled.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentMentionedEvent {
    /// The bot that was mentioned.
    pub bot_id: BotId,
    /// The message that triggered this, verbatim, with its parent.
    pub message: MessagePostedMetadata,
}

/// Events that open a new session.
#[non_exhaustive]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "source", rename_all = "snake_case")]
pub enum NewAgentSessionEvent {
    /// Opened by a bot mention in a top-level channel message.
    TopLevelMentioned(AgentBotMentionedEvent),
    /// Opened by a bot mention on a message parent other than a channel.
    Mentioned(AgentMentionedEvent),
}

/// The mention a new-session event carries, whichever parent it was on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpeningMention {
    /// The bot that was mentioned.
    pub bot_id: BotId,
    /// The mentioning message, with its parent.
    pub message: MessagePostedMetadata,
}

impl NewAgentSessionEvent {
    /// The mention this event carries; `None` for a shape this build does
    /// not recognise, which a consumer skips rather than routes.
    #[must_use]
    pub fn mention(&self) -> Option<OpeningMention> {
        match self {
            Self::TopLevelMentioned(mentioned) => Some(OpeningMention {
                bot_id: mentioned.bot_id,
                message: posted_from_channel_event(&mentioned.message),
            }),
            Self::Mentioned(mentioned) => Some(OpeningMention {
                bot_id: mentioned.bot_id,
                message: mentioned.message.clone(),
            }),
        }
    }
}

/// A channel message for a session that already exists, in the channel-only
/// shape consumers built before message parents decode.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChannelEventMetadata {
    /// Whose session this is, so foreign traffic is dropped before any read.
    pub bot_id: BotId,
    /// The session to feed.
    pub session_id: AgentSessionId,
    /// How the message was attributed to the session.
    pub kind: ThreadMessageKind,
    /// The message, verbatim.
    pub message: ChannelMessagePostedMetadata,
}

/// A message for a session that already exists, with its parent. Today only
/// document discussions produce it; channel messages stay on
/// [`ExistingAgentSessionEvent::Channel`] until every consumer that predates
/// parents has rolled.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ThreadEventMetadata {
    /// Whose session this is, so foreign traffic is dropped before any read.
    pub bot_id: BotId,
    /// The session to feed.
    pub session_id: AgentSessionId,
    /// How the message was attributed to the session.
    pub kind: ThreadMessageKind,
    /// The message, verbatim, with its parent.
    pub message: MessagePostedMetadata,
}

/// Events for a session that already exists.
#[non_exhaustive]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "source", rename_all = "snake_case")]
pub enum ExistingAgentSessionEvent {
    /// A message arrived in the session's originating channel thread.
    Channel(ChannelEventMetadata),
    /// A message arrived in the session's originating thread on another parent.
    Thread(ThreadEventMetadata),
}

/// The message an existing-session event feeds, whichever parent it was on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionMessage {
    /// Whose session this is.
    pub bot_id: BotId,
    /// The session to feed.
    pub session_id: AgentSessionId,
    /// How the message was attributed to the session.
    pub kind: ThreadMessageKind,
    /// The message, with its parent.
    pub message: MessagePostedMetadata,
}

impl ExistingAgentSessionEvent {
    /// The message this event feeds; `None` for a shape this build does not
    /// recognise, which a consumer skips rather than routes.
    #[must_use]
    pub fn session_message(&self) -> Option<SessionMessage> {
        match self {
            Self::Channel(metadata) => Some(SessionMessage {
                bot_id: metadata.bot_id,
                session_id: metadata.session_id,
                kind: metadata.kind,
                message: posted_from_channel_event(&metadata.message),
            }),
            Self::Thread(metadata) => Some(SessionMessage {
                bot_id: metadata.bot_id,
                session_id: metadata.session_id,
                kind: metadata.kind,
                message: metadata.message.clone(),
            }),
        }
    }
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

impl AgentTriggerTopicEvent {
    /// The bot the event is for, when its shape is recognised.
    #[must_use]
    pub fn bot_id(&self) -> Option<BotId> {
        match self {
            Self::New(event) => event.mention().map(|mention| mention.bot_id),
            Self::Existing(event) => event.session_message().map(|message| message.bot_id),
        }
    }
}

impl TopicEvent for AgentTriggerTopicEvent {
    type Topic = MacroAgentSessionsTopic;

    const SCHEMA_VERSION: u8 = 1;
}

/// What the trigger decided for one bot, before the wire shape is chosen.
///
/// The decision is parent-aware; [`AgentSessionMacroEvent::from_decision`]
/// picks the channel-only shape for channel parents and the parent-aware one
/// for the rest.
#[derive(Debug, Clone, PartialEq, Eq)]
#[allow(
    clippy::large_enum_variant,
    reason = "both variants carry a whole message; boxing would only move the size"
)]
pub enum TriggerDecision {
    /// Open a session for a mentioned bot.
    Open {
        /// The bot that was mentioned.
        bot_id: BotId,
        /// The mentioning message.
        message: MessagePostedMetadata,
    },
    /// Feed a session that already exists.
    Existing {
        /// Whose session this is.
        bot_id: BotId,
        /// The session to feed.
        session_id: AgentSessionId,
        /// How the message was attributed to the session.
        kind: ThreadMessageKind,
        /// The message.
        message: MessagePostedMetadata,
    },
}

impl TriggerDecision {
    /// The bot the decision is for.
    #[must_use]
    pub fn bot_id(&self) -> BotId {
        match self {
            Self::Open { bot_id, .. } | Self::Existing { bot_id, .. } => *bot_id,
        }
    }

    /// The message the decision was made about.
    #[must_use]
    pub fn message(&self) -> &MessagePostedMetadata {
        match self {
            Self::Open { message, .. } | Self::Existing { message, .. } => message,
        }
    }
}

/// A channel-parent decision needs the channel's type to take the channel-only
/// wire shape, and the caller supplied none.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("a channel trigger event needs the channel type of channel {channel_id}")]
pub struct MissingChannelType {
    /// The channel whose type was not supplied.
    pub channel_id: Uuid,
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
    /// The wire event for a decision.
    ///
    /// A channel parent takes the channel-only shape, which carries the
    /// channel's type; any other parent takes the parent-aware shape and
    /// ignores `channel_type`.
    pub fn from_decision(
        decision: TriggerDecision,
        channel_type: Option<ChannelType>,
    ) -> Result<Self, MissingChannelType> {
        let channel = match &decision.message().parent {
            MessageParent::Channel(channel_id) => Some(
                channel_type
                    .map(|channel_type| (*channel_id, channel_type))
                    .ok_or(MissingChannelType {
                        channel_id: *channel_id,
                    })?,
            ),
            MessageParent::Document(_) => None,
        };
        Ok(match decision {
            TriggerDecision::Open { bot_id, message } => match channel {
                Some((channel_id, channel_type)) => Self::new_session(
                    NewAgentSessionEvent::TopLevelMentioned(AgentBotMentionedEvent {
                        bot_id,
                        message: channel_event_from_posted(&message, channel_id, channel_type),
                    }),
                ),
                None => Self::new_session(NewAgentSessionEvent::Mentioned(AgentMentionedEvent {
                    bot_id,
                    message,
                })),
            },
            TriggerDecision::Existing {
                bot_id,
                session_id,
                kind,
                message,
            } => match channel {
                Some((channel_id, channel_type)) => Self::existing_event(
                    ExistingAgentSessionEvent::Channel(ChannelEventMetadata {
                        bot_id,
                        session_id,
                        kind,
                        message: channel_event_from_posted(&message, channel_id, channel_type),
                    }),
                    bot_id,
                ),
                None => Self::existing_event(
                    ExistingAgentSessionEvent::Thread(ThreadEventMetadata {
                        bot_id,
                        session_id,
                        kind,
                        message,
                    }),
                    bot_id,
                ),
            },
        })
    }

    /// Open a session for a bot.
    #[must_use]
    pub fn new_session(event: NewAgentSessionEvent) -> Self {
        let bot_id = match &event {
            NewAgentSessionEvent::TopLevelMentioned(mentioned) => mentioned.bot_id,
            NewAgentSessionEvent::Mentioned(mentioned) => mentioned.bot_id,
        };
        Self::new(bot_id, AgentTriggerTopicEvent::New(event))
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

/// The parent-aware shape of a channel post carried in the channel-only shape.
///
/// A channel event names its channel and, for a reply, its thread; the root
/// is the thread when there is one and the message itself otherwise, exactly
/// as the message service derives it.
#[must_use]
pub fn posted_from_channel_event(posted: &ChannelMessagePostedMetadata) -> MessagePostedMetadata {
    MessagePostedMetadata {
        parent: MessageParent::Channel(posted.channel_id),
        message_id: posted.message_id,
        thread_id: posted.thread_id,
        root_id: posted.thread_id.unwrap_or(posted.message_id),
        sender: posted.sender.clone(),
        triggered_by: posted.triggered_by.clone(),
        content: posted.content.clone(),
        mentions: posted.mentions.clone(),
        attachments: posted
            .attachments
            .iter()
            .map(|attachment| MessageEventAttachment {
                attachment_id: attachment.attachment_id,
                entity_type: attachment.entity_type.clone(),
                entity_id: attachment.entity_id.clone(),
                created_at: attachment.created_at,
            })
            .collect(),
        created_at: posted.created_at,
    }
}

/// The channel-only shape of a channel-parent post, for consumers built before
/// message parents. The parent is dropped and the channel's type, which the
/// parent-aware post does not carry, is supplied by the caller.
#[must_use]
pub fn channel_event_from_posted(
    posted: &MessagePostedMetadata,
    channel_id: Uuid,
    channel_type: ChannelType,
) -> ChannelMessagePostedMetadata {
    ChannelMessagePostedMetadata {
        channel_id,
        message_id: posted.message_id,
        thread_id: posted.thread_id,
        sender: posted.sender.clone(),
        triggered_by: posted.triggered_by.clone(),
        channel_type,
        content: posted.content.clone(),
        mentions: posted.mentions.clone(),
        attachments: posted
            .attachments
            .iter()
            .map(|attachment| ChannelEventAttachment {
                attachment_id: attachment.attachment_id,
                entity_type: attachment.entity_type.clone(),
                entity_id: attachment.entity_id.clone(),
                created_at: attachment.created_at,
            })
            .collect(),
        created_at: posted.created_at,
    }
}
