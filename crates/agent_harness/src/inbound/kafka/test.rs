use agent_session::domain::model::AgentSessionId;
use agent_trigger::domain::broker_events::{
    AgentBotMentionedEvent, AgentTriggerTopicEvent, ChannelEventMetadata, ChannelKind,
    ExistingAgentSessionEvent, NewAgentSessionEvent,
};
use channel_sender::ChannelSender;
use channels::domain::broker_events::ChannelMessagePostedMetadata;
use channels::domain::models::ChannelType;
use chrono::Utc;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;

use super::*;
use crate::domain::model::HarnessCommand;

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("asker@example.com").expect("a valid user id")
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
        kind: ChannelKind::DedicatedChannel,
        message: message(ChannelSender::new_from_user(user())),
    }))
}

#[test]
fn a_mention_for_our_bot_opens_a_session() {
    let (_, command) = agent_trigger_to_harness_command(
        mentioned(BotId::TEST_A, ChannelSender::new_from_user(user())),
        BotId::TEST_A,
    )
    .expect("a mention for our bot should yield a command");

    let HarnessCommand::Open(open) = command else {
        panic!("a new-session event should open");
    };
    assert_eq!(open.bot_id, BotId::TEST_A);
    assert_eq!(open.origin.message_id, Uuid::from_u128(2));
    // A top-level mention roots its own thread.
    assert_eq!(open.origin.thread_id, Uuid::from_u128(2));
    assert_eq!(open.origin.sender, user());
    assert_eq!(open.origin.content, "@claude fix the tests");
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

    let (_, HarnessCommand::Open(open)) = agent_trigger_to_harness_command(event, BotId::TEST_A)
        .expect("the mention should yield a command")
    else {
        panic!("a new-session event should open");
    };
    assert_eq!(open.origin.thread_id, thread);
}

#[test]
fn a_foreign_bots_event_is_skipped() {
    assert_eq!(
        agent_trigger_to_harness_command(
            mentioned(BotId::TEST_A, ChannelSender::new_from_user(user())),
            BotId::TEST_B,
        )
        .unwrap_err(),
        Skipped::ForeignBot
    );
    assert_eq!(
        agent_trigger_to_harness_command(channel_message(BotId::TEST_A), BotId::TEST_B)
            .unwrap_err(),
        Skipped::ForeignBot
    );
}

#[test]
fn a_bot_authored_mention_is_skipped() {
    assert_eq!(
        agent_trigger_to_harness_command(
            mentioned(BotId::TEST_A, ChannelSender::new_from_bot(BotId::TEST_B)),
            BotId::TEST_A,
        )
        .unwrap_err(),
        Skipped::NotFromUser
    );
}

#[test]
fn a_channel_message_forwards_to_its_session() {
    let (session_id, command) =
        agent_trigger_to_harness_command(channel_message(BotId::TEST_A), BotId::TEST_A)
            .expect("a channel event for our bot should yield a command");

    let HarnessCommand::Forward(forward) = command else {
        panic!("an existing-session event should forward");
    };
    assert_eq!(session_id, AgentSessionId::TEST_A);
    assert_eq!(forward.sender, Some(user()));
    assert_eq!(forward.content, "@claude fix the tests");
}
