use agent_runtime_protocol::domain::action::AgentAction;
use agent_session::domain::model::{AgentMcpServers, AgentSessionId};
use agent_trigger::domain::broker_events::{
    AgentBotMentionedEvent, AgentTriggerTopicEvent, ChannelEventMetadata, ChannelKind,
    ExistingAgentSessionEvent, NewAgentSessionEvent,
};
use bot_id::{BotId, MACRO_CODER_BOT_ID};
use channel_sender::ChannelSender;
use channels::domain::broker_events::ChannelMessagePostedMetadata;
use channels::domain::models::ChannelType;
use chrono::Utc;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;

use super::*;
use crate::domain::model::{AgentKind, AgentRuntimeConfig, HarnessCommand};

fn runtime(kind: AgentKind) -> Option<AgentRuntimeConfig> {
    Some(AgentRuntimeConfig {
        kind,
        model: "configured-model".to_owned(),
        harness: match kind {
            AgentKind::Cursor => "cursor",
            AgentKind::InMemory => "in-memory",
            AgentKind::SandboxedCoder => "opencode",
            AgentKind::External => "byoa",
        }
        .to_owned(),
        instructions: "configured instructions".to_owned(),
        mcp_servers: AgentMcpServers::OwnerConnections,
    })
}

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
        kind: ChannelKind::MentionThread,
        message: message(ChannelSender::new_from_user(user())),
    }))
}

#[test]
fn a_mention_for_our_bot_opens_a_session() {
    let routed = route_agent_trigger(
        mentioned(BotId::TEST_A, ChannelSender::new_from_user(user())),
        runtime(AgentKind::InMemory),
    )
    .expect("a mention for our bot should yield work");

    let RoutedTrigger::Command(_, HarnessCommand::Open(open)) = routed else {
        panic!("a new-session event should open");
    };
    assert_eq!(open.bot_id, BotId::TEST_A);
    assert_eq!(open.runtime.kind, AgentKind::InMemory);
    assert_eq!(open.runtime.model, "configured-model");
    assert_eq!(open.runtime.instructions, "configured instructions");
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

    let RoutedTrigger::Command(_, HarnessCommand::Open(open)) =
        route_agent_trigger(event, runtime(AgentKind::InMemory))
            .expect("the mention should yield work")
    else {
        panic!("a new-session event should open");
    };
    assert_eq!(open.origin.thread_id, thread);
}

#[test]
fn a_foreign_bots_open_is_skipped() {
    assert_eq!(
        route_agent_trigger(
            mentioned(BotId::TEST_A, ChannelSender::new_from_user(user())),
            None,
        )
        .unwrap_err(),
        Skipped::ForeignBot
    );
}

#[test]
fn an_unresolved_existing_session_is_treated_as_external() {
    assert!(matches!(
        route_agent_trigger(channel_message(MACRO_CODER_BOT_ID), None),
        Ok(RoutedTrigger::Announce(_, _))
    ));
}

#[test]
fn a_bot_authored_mention_is_skipped() {
    assert_eq!(
        route_agent_trigger(
            mentioned(BotId::TEST_A, ChannelSender::new_from_bot(BotId::TEST_B)),
            runtime(AgentKind::InMemory),
        )
        .unwrap_err(),
        Skipped::NotFromUser
    );
}

#[test]
fn any_user_mention_can_open_a_managed_agent() {
    let user = MacroUserIdStr::try_from_email("asker@example.com").expect("a valid user id");

    assert!(matches!(
        route_agent_trigger(
            mentioned(BotId::TEST_A, ChannelSender::new_from_user(user)),
            runtime(AgentKind::InMemory),
        ),
        Ok(RoutedTrigger::Command(_, HarnessCommand::Open(_)))
    ));
}

#[test]
fn a_managed_channel_message_forwards_to_its_session() {
    let routed = route_agent_trigger(
        channel_message(MACRO_CODER_BOT_ID),
        runtime(AgentKind::SandboxedCoder),
    )
    .expect("a channel event for our bot should yield work");

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
    assert_eq!(announce.message_id, Uuid::from_u128(2));
}

#[test]
fn an_external_channel_message_announces_only() {
    // The external bot's own runtime delivers the prompt; this deployment
    // only posts the chip, whichever bot it manages itself.
    let routed = route_agent_trigger(channel_message(BotId::TEST_A), runtime(AgentKind::External))
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
            kind: ChannelKind::MentionThread,
            message: message(ChannelSender::new_from_bot(BotId::TEST_B)),
        },
    ));
    assert_eq!(
        route_agent_trigger(event, runtime(AgentKind::External)).unwrap_err(),
        Skipped::NotFromUser
    );
}

fn channel_message_from(bot: BotId, sender: ChannelSender<'static>) -> AgentTriggerTopicEvent {
    AgentTriggerTopicEvent::Existing(ExistingAgentSessionEvent::Channel(ChannelEventMetadata {
        bot_id: bot,
        session_id: AgentSessionId::TEST_A,
        kind: ChannelKind::MentionThread,
        message: message(sender),
    }))
}

#[test]
fn any_user_can_follow_up_to_their_cursor_session() {
    let user = MacroUserIdStr::try_from_email("asker@example.com").expect("a valid user id");
    assert!(matches!(
        route_agent_trigger(
            channel_message_from(bot_id::CURSOR_BOT_ID, ChannelSender::new_from_user(user)),
            runtime(AgentKind::Cursor),
        ),
        Ok(RoutedTrigger::Command(_, HarnessCommand::Deliver(_)))
    ));
}

/// Managed sessions accept follow-ups from channel users regardless of email domain.
#[test]
fn any_user_can_follow_up_to_a_coder_session() {
    let user = MacroUserIdStr::try_from_email("asker@example.com").expect("a valid user id");
    let routed = route_agent_trigger(
        channel_message_from(MACRO_CODER_BOT_ID, ChannelSender::new_from_user(user)),
        runtime(AgentKind::SandboxedCoder),
    )
    .expect("channel users may follow up");
    assert!(matches!(
        routed,
        RoutedTrigger::Command(_, HarnessCommand::Deliver(_))
    ));
}

#[test]
fn a_bot_authored_follow_up_to_a_managed_session_still_delivers() {
    let routed = route_agent_trigger(
        channel_message_from(
            MACRO_CODER_BOT_ID,
            ChannelSender::new_from_bot(BotId::TEST_B),
        ),
        runtime(AgentKind::SandboxedCoder),
    )
    .expect("explicit bot mentions continue to reach managed sessions");

    let RoutedTrigger::Command(_, HarnessCommand::Deliver(deliver)) = routed else {
        panic!("a managed bot-authored follow-up should deliver");
    };
    assert_eq!(deliver.actor, None);
}
