use super::*;
use agent_session::domain::model::AgentSessionId;
use macro_event_broker::MacroEvent;

use crate::domain::broker_events::AgentTriggerTopicEvent;

fn user_sender() -> ChannelSender<'static> {
    ChannelSender::new_from_user(
        macro_user_id::user_id::MacroUserIdStr::try_from_email("someone@example.com")
            .expect("valid macro user id"),
    )
}

fn session_message(
    bot_id: BotId,
    sender: ChannelSender<'static>,
) -> AgentSessionMessagePostedMetadata {
    AgentSessionMessagePostedMetadata {
        bot_id,
        agent_session_id: AgentSessionId::TEST_A,
        sender,
        content: "keep going".to_owned(),
    }
}

/// A message addressed to the session needs no mention and no lookup: naming
/// the session is the ask.
#[test]
fn a_session_message_forwards_without_a_mention() {
    let message = session_message(BotId::TEST_A, user_sender());

    let decision = yield_event(&PotentialTriggerEvent::AgentSessionMessage(&message), true);

    let event = decision.into_event().expect("a session message forwards");
    let AgentTriggerTopicEvent::Existing(ExistingAgentSessionEvent::AgentSessionMessage(forwarded)) =
        &event.event().event
    else {
        panic!("expected a session-message event");
    };
    assert_eq!(forwarded.agent_session_id, AgentSessionId::TEST_A);
    assert_eq!(forwarded.content, "keep going");
}

/// The universal gates still apply: the agent must exist, and its own replies
/// must not feed back into it.
#[test]
fn a_session_message_respects_the_universal_gates() {
    let message = session_message(BotId::TEST_A, user_sender());
    let no_agent = yield_event(&PotentialTriggerEvent::AgentSessionMessage(&message), false);
    assert!(matches!(
        no_agent,
        AgentSessionEventDecision::NoEvent(NoEventReason::BotHasNoAgent { .. })
    ));

    let own = session_message(BotId::TEST_A, ChannelSender::new_from_bot(BotId::TEST_A));
    let looped = yield_event(&PotentialTriggerEvent::AgentSessionMessage(&own), true);
    assert!(matches!(
        looped,
        AgentSessionEventDecision::NoEvent(NoEventReason::OwnMessage { .. })
    ));
}
