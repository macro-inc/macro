use agent_runtime_protocol::domain::action::AgentAction;
use agent_session::domain::model::AgentSessionId;
use agent_trigger::domain::broker_events::{
    AgentBotMentionedEvent, AgentTriggerTopicEvent, ChannelEventMetadata,
    ExistingAgentSessionEvent, NewAgentSessionEvent,
};
use bot_id::MACRO_CODER_BOT_ID;
use channel_sender::ChannelSender;
use channels::domain::broker_events::ChannelMessagePostedMetadata;
use channels::domain::models::ChannelType;
use chrono::Utc;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;

use super::*;
use crate::domain::model::HarnessCommand;
use bot_id::BotId;

/// This deployment provisions the bot's sandbox.
const MANAGED: bool = true;
/// The bot's own runtime does.
const EXTERNAL: bool = false;

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("asker@macro.com").expect("a valid user id")
}

fn message(sender: ChannelSender<'static>) -> ChannelMessagePostedMetadata {
    ChannelMessagePostedMetadata {
        channel_id: Uuid::from_u128(1),
        message_id: Uuid::from_u128(2),
        thread_id: None,
        sender,
        triggered_by: None,
        channel_type: ChannelType::Public,
        content: "@claude fix the tests".to_owned(),
        mentions: vec![],
        attachments: vec![],
        created_at: Utc::now(),
    }
}

fn mentioned(bot: BotId, sender: ChannelSender<'static>) -> AgentTriggerTopicEvent {
    AgentTriggerTopicEvent::New(NewAgentSessionEvent::TopLevelMentioned(
        AgentBotMentionedEvent {
            bot_id: bot,
            message: message(sender),
        },
    ))
}

fn channel_message(bot: BotId) -> AgentTriggerTopicEvent {
    AgentTriggerTopicEvent::Existing(ExistingAgentSessionEvent::Channel(ChannelEventMetadata {
        bot_id: bot,
        session_id: AgentSessionId::TEST_A,
        message: message(ChannelSender::new_from_user(user())),
    }))
}

#[test]
fn a_mention_for_a_managed_bot_opens_a_session() {
    let routed = route_agent_trigger(
        mentioned(BotId::TEST_A, ChannelSender::new_from_user(user())),
        MANAGED,
    )
    .expect("a mention for a bot we manage should yield work");

    let RoutedTrigger::Command(_, HarnessCommand::Open(open)) = routed else {
        panic!("a new-session event should open");
    };
    assert_eq!(open.bot_id, BotId::TEST_A);
    assert_eq!(open.origin.message_id, Uuid::from_u128(2));
    // A top-level mention roots its own thread.
    assert_eq!(open.origin.thread_id, Uuid::from_u128(2));
    assert_eq!(open.origin.sender, user());
    assert_eq!(open.origin.content, "@claude fix the tests");
}

/// One deployment serves every persona, so the bot id is carried by the
/// command rather than matched against a configured one: any managed bot's
/// mention opens, not just a single blessed id.
#[test]
fn any_managed_bots_mention_opens_a_session() {
    let routed = route_agent_trigger(
        mentioned(BotId::TEST_B, ChannelSender::new_from_user(user())),
        MANAGED,
    )
    .expect("a mention for any managed bot should yield work");

    let RoutedTrigger::Command(_, HarnessCommand::Open(open)) = routed else {
        panic!("a new-session event should open");
    };
    assert_eq!(open.bot_id, BotId::TEST_B);
}

#[test]
fn a_threaded_mention_answers_into_its_thread() {
    let thread = Uuid::from_u128(9);
    let mut event = message(ChannelSender::new_from_user(user()));
    event.thread_id = Some(thread);
    let event = AgentTriggerTopicEvent::New(NewAgentSessionEvent::TopLevelMentioned(
        AgentBotMentionedEvent {
            bot_id: BotId::TEST_A,
            message: event,
        },
    ));

    let RoutedTrigger::Command(_, HarnessCommand::Open(open)) =
        route_agent_trigger(event, MANAGED).expect("the mention should yield work")
    else {
        panic!("a new-session event should open");
    };
    assert_eq!(open.origin.thread_id, thread);
}

/// An external bot's runtime opens its own sessions over the API, so a
/// mention of one is not ours to act on.
#[test]
fn an_external_bots_open_is_skipped() {
    assert_eq!(
        route_agent_trigger(
            mentioned(BotId::TEST_A, ChannelSender::new_from_user(user())),
            EXTERNAL,
        )
        .unwrap_err(),
        Skipped::ForeignBot
    );
}

#[test]
fn a_bot_authored_mention_is_skipped() {
    assert_eq!(
        route_agent_trigger(
            mentioned(BotId::TEST_A, ChannelSender::new_from_bot(BotId::TEST_B)),
            MANAGED,
        )
        .unwrap_err(),
        Skipped::NotFromUser
    );
}

#[test]
fn a_non_staff_mention_is_skipped() {
    let user = MacroUserIdStr::try_from_email("asker@example.com").expect("a valid user id");

    assert_eq!(
        route_agent_trigger(
            mentioned(BotId::TEST_A, ChannelSender::new_from_user(user)),
            MANAGED,
        )
        .unwrap_err(),
        Skipped::NotMacroStaff
    );
}

#[test]
fn a_managed_channel_message_forwards_to_its_session() {
    let routed = route_agent_trigger(channel_message(MACRO_CODER_BOT_ID), MANAGED)
        .expect("a channel event for a bot we manage should yield work");

    let RoutedTrigger::Command(session_id, HarnessCommand::Deliver(deliver)) = routed else {
        panic!("a managed existing-session event should deliver");
    };
    assert_eq!(session_id, AgentSessionId::TEST_A);
    assert_eq!(deliver.actor, Some(user()));
    assert_eq!(
        deliver.action,
        AgentAction::prompt("@claude fix the tests"),
        "a channel message becomes a prompt"
    );
    // Offered rather than decided here: whether this is the session's own
    // channel is not knowable from the event alone.
    let announce = deliver.announce.expect("a channel prompt offers an origin");
    assert_eq!(announce.channel_id, Uuid::from_u128(1));
    assert_eq!(announce.thread_id, Uuid::from_u128(2));
}

#[test]
fn an_external_channel_message_announces_only() {
    // The external bot's own runtime delivers the prompt; this deployment
    // only posts the chip.
    let routed = route_agent_trigger(channel_message(BotId::TEST_A), EXTERNAL)
        .expect("an external existing-session event should yield work");

    let RoutedTrigger::Announce(session_id, prompt) = routed else {
        panic!("an external existing-session event should announce");
    };
    assert_eq!(session_id, AgentSessionId::TEST_A);
    assert_eq!(prompt.bot_id, BotId::TEST_A);
    assert_eq!(prompt.sender, user());
    assert_eq!(prompt.content, "@claude fix the tests");
    assert_eq!(prompt.origin.channel_id, Uuid::from_u128(1));
    assert_eq!(prompt.origin.thread_id, Uuid::from_u128(2));
}

#[test]
fn a_bot_authored_external_channel_message_is_skipped() {
    let event = AgentTriggerTopicEvent::Existing(ExistingAgentSessionEvent::Channel(
        ChannelEventMetadata {
            bot_id: BotId::TEST_A,
            session_id: AgentSessionId::TEST_A,
            message: message(ChannelSender::new_from_bot(BotId::TEST_B)),
        },
    ));
    assert_eq!(
        route_agent_trigger(event, EXTERNAL).unwrap_err(),
        Skipped::NotFromUser
    );
}

/// The consumer loop reads the bot off the event to look up whether we manage
/// it, so every routable shape has to name one.
#[test]
fn every_routable_event_names_its_bot() {
    assert_eq!(
        trigger_bot_id(&mentioned(
            BotId::TEST_A,
            ChannelSender::new_from_user(user())
        )),
        Some(BotId::TEST_A)
    );
    assert_eq!(
        trigger_bot_id(&channel_message(BotId::TEST_B)),
        Some(BotId::TEST_B)
    );
}
