//! What a channel message means for one bot.

use agent_session::domain::model::{AgentSessionId, ChannelSession};
use bot_id::BotId;
use channels::domain::broker_events::ChannelMessagePostedMetadata;
use channels::domain::side_effects::bot_mention_ids;

use crate::domain::broker_events::{
    AgentBotMentionedEvent, AgentSessionMacroEvent, ChannelEventMetadata, ChannelKind,
    NewAgentSessionEvent,
};

/// Why evaluating a message did not produce an agent-session event.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NoEventReason {
    /// No existing session and no mentioned bot identified the target agent.
    MissingBotContext,
    /// The target bot is not configured with an agent.
    BotHasNoAgent {
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
}

/// Result of evaluating one message for one bot and session context.
#[derive(Debug)]
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
pub fn is_own_message(bot: BotId, posted: &ChannelMessagePostedMetadata) -> bool {
    posted.sender.as_bot().map(|sender| sender.bot_id()) == Some(bot)
}

/// What to publish for a message and its previously looked-up session context.
///
/// Existing sessions carry their own bot identity. `mentioned_bot` identifies
/// the bot being evaluated when no session exists, while `has_agent` gates all
/// event production.
#[must_use]
pub fn yield_event(
    posted: &ChannelMessagePostedMetadata,
    existing: &ChannelSession,
    mentioned_bot: Option<BotId>,
    has_agent: bool,
) -> AgentSessionEventDecision {
    let session_bot = match existing {
        ChannelSession::InDedicatedChannel(session)
        | ChannelSession::CreatedFromThread(session) => session.bot_id,
        ChannelSession::None => match mentioned_bot {
            Some(bot_id) => bot_id,
            None => {
                return AgentSessionEventDecision::NoEvent(NoEventReason::MissingBotContext);
            }
        },
        ChannelSession::ThreadInDedicatedChannel {
            dedicated_channel_agent_session: _,
            subthread_agent_session: _,
        } => todo!("yielding events for nested agent sessions"),
    };

    if !has_agent {
        return AgentSessionEventDecision::NoEvent(NoEventReason::BotHasNoAgent {
            bot_id: session_bot,
        });
    }

    if is_own_message(session_bot, posted) {
        return AgentSessionEventDecision::NoEvent(NoEventReason::OwnMessage {
            bot_id: session_bot,
        });
    }

    let mentioned = bot_mention_ids(&posted.mentions).contains(&session_bot);

    let (session_id, kind) = match (existing, mentioned) {
        // Every message in the session's dedicated channel is for the agent.
        (ChannelSession::InDedicatedChannel(session), _) => {
            (session.id, ChannelKind::DedicatedChannel)
        }
        (ChannelSession::CreatedFromThread(session), true) => {
            (session.id, ChannelKind::MentionThread)
        }
        (ChannelSession::None, true) => {
            return AgentSessionEventDecision::Event(AgentSessionMacroEvent::new_session(
                NewAgentSessionEvent::TopLevelMentioned(AgentBotMentionedEvent {
                    bot_id: session_bot,
                    message: posted.clone(),
                }),
            ));
        }
        (ChannelSession::ThreadInDedicatedChannel { .. }, _) => unreachable!(
            "nested agent sessions return a no-event decision before mention evaluation"
        ),
        (ChannelSession::CreatedFromThread(session), false) => {
            return AgentSessionEventDecision::NoEvent(NoEventReason::MentionRequired {
                bot_id: session_bot,
                session_id: Some(session.id),
            });
        }
        (ChannelSession::None, false) => {
            return AgentSessionEventDecision::NoEvent(NoEventReason::MentionRequired {
                bot_id: session_bot,
                session_id: None,
            });
        }
    };

    AgentSessionEventDecision::Event(AgentSessionMacroEvent::channel_event(
        ChannelEventMetadata {
            bot_id: session_bot,
            session_id,
            kind,
            message: posted.clone(),
        },
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::broker_events::{AgentTriggerTopicEvent, ExistingAgentSessionEvent};
    use agent_session::domain::model::{AgentSession, AgentSessionId, SessionStatus};
    use channel_sender::ChannelSender;
    use channels::domain::models::{ChannelType, SimpleMention};
    use chrono::Utc;
    use macro_event_broker::MacroEvent;
    use macro_user_id::cowlike::CowLike;
    use macro_user_id::user_id::MacroUserIdStr;
    use macro_uuid::Uuid;

    fn user() -> MacroUserIdStr<'static> {
        MacroUserIdStr::parse_from_str("macro|someone@macro.com")
            .expect("valid user id")
            .into_owned()
    }

    fn mention_of(bot: BotId) -> SimpleMention {
        SimpleMention {
            entity_type: "bot".to_string(),
            entity_id: bot.into_storage_id().as_ref().to_string(),
        }
    }

    fn message(
        sender: ChannelSender<'static>,
        mentions: Vec<SimpleMention>,
    ) -> ChannelMessagePostedMetadata {
        ChannelMessagePostedMetadata {
            channel_id: Uuid::from_u128(1),
            message_id: Uuid::from_u128(2),
            thread_id: None,
            sender,
            triggered_by: None,
            channel_type: ChannelType::Public,
            content: "hello".to_string(),
            mentions,
            attachments: vec![],
            created_at: Utc::now(),
        }
    }

    fn from_user(mentions: Vec<SimpleMention>) -> ChannelMessagePostedMetadata {
        message(ChannelSender::new_from_user(user()), mentions)
    }

    fn session(id: AgentSessionId) -> AgentSession {
        AgentSession {
            id,
            channel_id: Uuid::from_u128(3),
            thread_id: Some(Uuid::from_u128(2)),
            originating_message_id: Some(Uuid::from_u128(2)),
            bot_id: BotId::TEST_A,
            model: "model".to_string(),
            harness: "harness".to_string(),
            repo_url: "https://example.com/repo".to_string(),
            acp_session_id: None,
            status: SessionStatus::NoMessages,
            created_at: Utc::now(),
            modified_at: Utc::now(),
        }
    }

    fn no_event_reason(decision: AgentSessionEventDecision) -> NoEventReason {
        let AgentSessionEventDecision::NoEvent(reason) = decision else {
            panic!("expected no-event decision");
        };
        reason
    }

    #[test]
    fn ignores_our_own_messages_even_in_our_own_thread() {
        let posted = message(
            ChannelSender::new_from_bot(BotId::TEST_A),
            vec![mention_of(BotId::TEST_A)],
        );

        assert_eq!(
            no_event_reason(yield_event(
                &posted,
                &ChannelSession::InDedicatedChannel(session(AgentSessionId::TEST_A)),
                Some(BotId::TEST_A),
                true,
            )),
            NoEventReason::OwnMessage {
                bot_id: BotId::TEST_A
            }
        );
    }

    #[test]
    fn ignores_a_bot_that_mentions_itself_without_an_existing_session() {
        let posted = message(
            ChannelSender::new_from_bot(BotId::TEST_A),
            vec![mention_of(BotId::TEST_A)],
        );

        assert_eq!(
            no_event_reason(yield_event(
                &posted,
                &ChannelSession::None,
                Some(BotId::TEST_A),
                true,
            )),
            NoEventReason::OwnMessage {
                bot_id: BotId::TEST_A
            }
        );
    }

    #[test]
    fn another_bots_message_is_not_ours_to_ignore() {
        let posted = message(
            ChannelSender::new_from_bot(BotId::TEST_B),
            vec![mention_of(BotId::TEST_A)],
        );

        let event = yield_event(&posted, &ChannelSession::None, Some(BotId::TEST_A), true)
            .into_event()
            .expect("opens a session");
        assert!(matches!(
            &event.event().event,
            AgentTriggerTopicEvent::New(NewAgentSessionEvent::TopLevelMentioned(_))
        ));
    }

    #[test]
    fn a_mention_with_no_session_opens_one_rooted_at_the_thread() {
        let posted = from_user(vec![mention_of(BotId::TEST_A)]);

        let event = yield_event(&posted, &ChannelSession::None, Some(BotId::TEST_A), true)
            .into_event()
            .expect("opens a session");
        let AgentTriggerTopicEvent::New(NewAgentSessionEvent::TopLevelMentioned(mentioned)) =
            &event.event().event
        else {
            panic!("expected a mention-opened session");
        };
        assert_eq!(mentioned.bot_id, BotId::TEST_A);
        assert_eq!(&mentioned.message, &posted);
        assert_eq!(event.key(), BotId::TEST_A.to_string());
    }

    #[test]
    fn a_reply_mention_preserves_its_channel_context_in_the_message() {
        let mut posted = from_user(vec![mention_of(BotId::TEST_A)]);
        posted.thread_id = Some(Uuid::from_u128(9));

        let event = yield_event(&posted, &ChannelSession::None, Some(BotId::TEST_A), true)
            .into_event()
            .expect("opens a session");
        let AgentTriggerTopicEvent::New(NewAgentSessionEvent::TopLevelMentioned(mentioned)) =
            &event.event().event
        else {
            panic!("expected a mention-opened session");
        };
        assert_eq!(mentioned.message.thread_id, Some(Uuid::from_u128(9)));
    }

    #[test]
    fn no_session_and_no_mention_is_ignored() {
        let posted = from_user(vec![]);

        assert!(matches!(
            no_event_reason(yield_event(
                &posted,
                &ChannelSession::None,
                Some(BotId::TEST_A),
                true,
            )),
            NoEventReason::MentionRequired { .. }
        ));
    }

    #[test]
    fn a_mention_of_another_bot_is_not_ours() {
        let posted = from_user(vec![mention_of(BotId::TEST_B)]);

        assert!(matches!(
            no_event_reason(yield_event(
                &posted,
                &ChannelSession::None,
                Some(BotId::TEST_A),
                true,
            )),
            NoEventReason::MentionRequired { .. }
        ));
    }

    #[test]
    fn the_dedicated_channel_needs_no_mention() {
        let posted = from_user(vec![]);

        let event = yield_event(
            &posted,
            &ChannelSession::InDedicatedChannel(session(AgentSessionId::TEST_A)),
            None,
            true,
        )
        .into_event()
        .expect("feeds the session");
        let AgentTriggerTopicEvent::Existing(ExistingAgentSessionEvent::Channel(channel_event)) =
            &event.event().event
        else {
            panic!("expected a channel event");
        };
        assert_eq!(channel_event.kind, ChannelKind::DedicatedChannel);
        assert_eq!(channel_event.session_id, AgentSessionId::TEST_A);
        assert_eq!(channel_event.bot_id, BotId::TEST_A);
        assert_eq!(&channel_event.message, &posted);
        assert_eq!(event.key(), BotId::TEST_A.to_string());
    }

    #[test]
    fn the_mention_thread_resumes_only_on_a_mention() {
        let mentioned = from_user(vec![mention_of(BotId::TEST_A)]);
        let event = yield_event(
            &mentioned,
            &ChannelSession::CreatedFromThread(session(AgentSessionId::TEST_A)),
            Some(BotId::TEST_A),
            true,
        )
        .into_event()
        .expect("feeds the session");
        let AgentTriggerTopicEvent::Existing(ExistingAgentSessionEvent::Channel(channel_event)) =
            &event.event().event
        else {
            panic!("expected a channel event");
        };
        assert_eq!(channel_event.kind, ChannelKind::MentionThread);
        assert_eq!(channel_event.session_id, AgentSessionId::TEST_A);
        assert_eq!(channel_event.bot_id, BotId::TEST_A);
        assert_eq!(&channel_event.message, &mentioned);

        let quiet = from_user(vec![]);
        assert!(matches!(
            no_event_reason(yield_event(
                &quiet,
                &ChannelSession::CreatedFromThread(session(AgentSessionId::TEST_A)),
                None,
                true,
            )),
            NoEventReason::MentionRequired { .. }
        ));
    }

    #[test]
    #[should_panic(expected = "not yet implemented: yielding events for nested agent sessions")]
    fn an_ambiguous_dedicated_channel_subthread_is_explicitly_unsupported() {
        let posted = from_user(vec![mention_of(BotId::TEST_A)]);
        let existing = ChannelSession::ThreadInDedicatedChannel {
            dedicated_channel_agent_session: session(AgentSessionId::TEST_A),
            subthread_agent_session: session(AgentSessionId::TEST_B),
        };

        let _ = yield_event(&posted, &existing, Some(BotId::TEST_A), true);
    }

    #[test]
    fn a_bot_without_an_agent_is_always_ignored() {
        let posted = from_user(vec![mention_of(BotId::TEST_A)]);

        assert_eq!(
            no_event_reason(yield_event(
                &posted,
                &ChannelSession::InDedicatedChannel(session(AgentSessionId::TEST_A)),
                Some(BotId::TEST_A),
                false,
            )),
            NoEventReason::BotHasNoAgent {
                bot_id: BotId::TEST_A
            }
        );
    }
}
