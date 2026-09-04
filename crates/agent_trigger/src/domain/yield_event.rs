//! What one incoming message means for one bot.

use agent_session::domain::model::{AgentSessionId, ChannelSession};
use bot_id::BotId;
use channel_sender::ChannelSender;
use channels::domain::broker_events::ChannelMessagePostedMetadata;
use channels::domain::side_effects::bot_mention_ids;

use crate::domain::broker_events::{
    AgentBotMentionedEvent, AgentSessionMacroEvent, ChannelEventMetadata, ChannelKind,
    NewAgentSessionEvent,
};

/// Why evaluating a message did not produce an agent-session event.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::AsRefStr)]
#[strum(serialize_all = "snake_case")]
pub enum NoEventReason {
    /// No existing session and no mentioned bot identified the target agent.
    MissingBotContext,
    /// The target bot is not an available agent for this sender and channel.
    BotUnavailable {
        /// Bot that was evaluated.
        bot_id: BotId,
    },
    /// The target bot authored this message, so feeding it back would loop.
    OwnMessage {
        /// Bot that authored and would otherwise receive the message.
        bot_id: BotId,
    },
    /// This surface only routes messages that explicitly mention the target bot.
    MentionRequired {
        /// Bot that was evaluated.
        bot_id: BotId,
        /// Existing session, when one matched the originating thread.
        session_id: Option<AgentSessionId>,
    },
    /// Another bot-specific lookup already yielded this existing session.
    DuplicateSession {
        /// Session already evaluated for this message.
        session_id: AgentSessionId,
    },
    /// The message sat in a session's thread without a mention, and neither
    /// an explicit reply to the agent nor the model judged it addressed.
    NotAddressedToAgent {
        /// Session whose thread carried the message.
        session_id: AgentSessionId,
    },
    /// Several agents are live in the thread and nothing said which one the
    /// message was for.
    AmbiguousAgentSessions {
        /// How many agent-backed sessions the thread carried.
        candidates: usize,
    },
}

/// Result of evaluating one message for one bot and session context.
#[derive(Debug)]
#[allow(
    clippy::large_enum_variant,
    reason = "the event carries a whole message; boxing would only move the size"
)]
pub enum AgentSessionEventDecision {
    /// Publish this event.
    Event(AgentSessionMacroEvent),
    /// Do not publish, for some reason the agent harness was not triggered.
    NoEvent(NoEventReason),
}

impl AgentSessionEventDecision {
    /// Returns the event when this decision emits one.
    #[must_use]
    pub fn into_event(self) -> Option<AgentSessionMacroEvent> {
        match self {
            Self::Event(event) => Some(event),
            Self::NoEvent(_) => None,
        }
    }
}

/// Whether this message is one our own bot posted.
///
/// Checked before anything else: the agent replies into its own thread, and
/// reacting to that reply feeds it back to itself forever.
#[must_use]
pub fn is_own_message(bot: BotId, sender: &ChannelSender<'_>) -> bool {
    sender.as_bot().map(|sender| sender.bot_id()) == Some(bot)
}

/// One message the trigger might react to, with the context that case needs.
#[derive(Debug)]
pub enum PotentialTriggerEvent<'a> {
    /// A message posted in a comms channel, with the session lookup it
    /// required and the bot being evaluated for it.
    Channel {
        /// The message, as the channel topic carried it.
        posted: &'a ChannelMessagePostedMetadata,
        /// The session lookup for the message's thread context.
        existing: &'a ChannelSession,
        /// The bot being evaluated when no session exists.
        mentioned_bot: Option<BotId>,
    },
}

/// What to publish for one incoming message.
///
/// Existing sessions carry their own bot identity. Current agent availability
/// gates all event production.
#[must_use]
pub fn yield_event(
    message: &PotentialTriggerEvent<'_>,
    available: bool,
) -> AgentSessionEventDecision {
    match message {
        PotentialTriggerEvent::Channel {
            posted,
            existing,
            mentioned_bot,
        } => yield_channel_event(posted, existing, *mentioned_bot, available),
    }
}

fn yield_channel_event(
    posted: &ChannelMessagePostedMetadata,
    existing: &ChannelSession,
    mentioned_bot: Option<BotId>,
    available: bool,
) -> AgentSessionEventDecision {
    let session_bot = match existing {
        ChannelSession::CreatedFromThread(session) => session.bot_id,
        ChannelSession::None => match mentioned_bot {
            Some(bot_id) => bot_id,
            None => {
                return AgentSessionEventDecision::NoEvent(NoEventReason::MissingBotContext);
            }
        },
    };

    if !available {
        return AgentSessionEventDecision::NoEvent(NoEventReason::BotUnavailable {
            bot_id: session_bot,
        });
    }

    if is_own_message(session_bot, &posted.sender) {
        return AgentSessionEventDecision::NoEvent(NoEventReason::OwnMessage {
            bot_id: session_bot,
        });
    }

    let mentioned = bot_mention_ids(&posted.mentions).contains(&session_bot);

    match (existing, mentioned) {
        (ChannelSession::CreatedFromThread(session), true) => AgentSessionEventDecision::Event(
            AgentSessionMacroEvent::channel_event(ChannelEventMetadata {
                bot_id: session_bot,
                session_id: session.id,
                kind: ChannelKind::MentionThread,
                message: posted.clone(),
            }),
        ),
        (ChannelSession::None, true) => {
            AgentSessionEventDecision::Event(AgentSessionMacroEvent::new_session(
                NewAgentSessionEvent::TopLevelMentioned(AgentBotMentionedEvent {
                    bot_id: session_bot,
                    message: posted.clone(),
                }),
            ))
        }
        (ChannelSession::CreatedFromThread(session), false) => {
            AgentSessionEventDecision::NoEvent(NoEventReason::MentionRequired {
                bot_id: session_bot,
                session_id: Some(session.id),
            })
        }
        (ChannelSession::None, false) => {
            AgentSessionEventDecision::NoEvent(NoEventReason::MentionRequired {
                bot_id: session_bot,
                session_id: None,
            })
        }
    }
}
