use super::*;

use agent_session::domain::model::{AgentSession, AgentSessionId, ChannelSession, SessionStatus};
use agent_session::domain::ports::MockAgentSessionRepo;
use channel_sender::ChannelSender;
use channels::domain::models::{ChannelType, SimpleMention};
use chrono::Utc;
use macro_event_broker::MacroEvent;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;

use crate::domain::broker_events::{
    AgentSessionTopicEvent, ChannelKind, ExistingAgentSessionEvent, NewAgentSessionEvent,
};

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str("macro|trigger-service-test@macro.com")
        .expect("valid user id")
        .into_owned()
}

fn mention_of(bot: BotId) -> SimpleMention {
    SimpleMention {
        entity_type: "bot".to_owned(),
        entity_id: bot.into_storage_id().as_ref().to_owned(),
    }
}

fn message(mentions: Vec<SimpleMention>) -> ChannelMessagePostedMetadata {
    ChannelMessagePostedMetadata {
        channel_id: Uuid::from_u128(1),
        message_id: Uuid::from_u128(2),
        thread_id: Some(Uuid::from_u128(3)),
        sender: ChannelSender::new_from_user(user()),
        triggered_by: None,
        channel_type: ChannelType::Public,
        content: "hello".to_owned(),
        mentions,
        attachments: vec![],
        created_at: Utc::now(),
    }
}

fn session(id: AgentSessionId, bot_id: BotId) -> AgentSession {
    AgentSession {
        id,
        channel_id: Uuid::from_u128(1),
        thread_id: None,
        originating_message_id: None,
        bot_id,
        model: "model".to_owned(),
        harness: "harness".to_owned(),
        repo_url: "https://example.com/repo".to_owned(),
        acp_session_id: None,
        status: SessionStatus::NoMessages,
        created_at: Utc::now(),
        modified_at: Utc::now(),
    }
}

#[tokio::test]
async fn evaluates_a_dedicated_channel_without_a_mentioned_bot() {
    let posted = message(vec![]);
    let mut sessions = MockAgentSessionRepo::new();
    sessions
        .expect_find_for_channel()
        .with(
            mockall::predicate::eq(posted.channel_id),
            mockall::predicate::eq(posted.thread_id),
            mockall::predicate::eq(None),
        )
        .once()
        .return_once(|_, _, _| {
            Box::pin(async {
                Ok(ChannelSession::InDedicatedChannel(session(
                    AgentSessionId::TEST_A,
                    BotId::TEST_A,
                )))
            })
        });
    let mut bots = MockAgentBotLookup::new();
    bots.expect_has_agent()
        .with(mockall::predicate::eq(BotId::TEST_A))
        .once()
        .return_once(|_| Box::pin(async { Ok(true) }));
    let service = AgentTriggerService::new(sessions, bots);

    let events = service.evaluate(&posted).await.expect("evaluate message");
    assert_eq!(events.len(), 1);
    let AgentSessionTopicEvent::Existing(ExistingAgentSessionEvent::Channel(metadata)) =
        &events[0].event().event
    else {
        panic!("expected a channel event");
    };
    assert_eq!(metadata.bot_id, BotId::TEST_A);
    assert_eq!(metadata.session_id, AgentSessionId::TEST_A);
    assert_eq!(metadata.kind, ChannelKind::DedicatedChannel);
}

#[tokio::test]
async fn evaluates_every_mentioned_agent_bot() {
    let posted = message(vec![mention_of(BotId::TEST_B), mention_of(BotId::TEST_A)]);
    let channel_id = posted.channel_id;
    let thread_id = posted.thread_id;
    let mut sessions = MockAgentSessionRepo::new();
    sessions
        .expect_find_for_channel()
        .withf(move |actual_channel_id, actual_thread_id, bot_id| {
            *actual_channel_id == channel_id && *actual_thread_id == thread_id && bot_id.is_some()
        })
        .times(2)
        .returning(|_, _, _| Box::pin(async { Ok(ChannelSession::None) }));
    let mut bots = MockAgentBotLookup::new();
    bots.expect_has_agent()
        .times(2)
        .returning(|_| Box::pin(async { Ok(true) }));
    let service = AgentTriggerService::new(sessions, bots);

    let events = service.evaluate(&posted).await.expect("evaluate message");
    assert_eq!(events.len(), 2);
    let mut event_bots: Vec<_> = events
        .iter()
        .map(|event| match &event.event().event {
            AgentSessionTopicEvent::New(NewAgentSessionEvent::TopLevelMentioned(mentioned)) => {
                mentioned.bot_id
            }
            other => panic!("expected a new-session event, got {other:?}"),
        })
        .collect();
    event_bots.sort_by_key(ToString::to_string);
    assert_eq!(event_bots, vec![BotId::TEST_A, BotId::TEST_B]);
}

#[tokio::test]
async fn evaluates_a_repeated_bot_mention_once() {
    let posted = message(vec![mention_of(BotId::TEST_A), mention_of(BotId::TEST_A)]);
    let mut sessions = MockAgentSessionRepo::new();
    sessions
        .expect_find_for_channel()
        .with(
            mockall::predicate::eq(posted.channel_id),
            mockall::predicate::eq(posted.thread_id),
            mockall::predicate::eq(Some(BotId::TEST_A)),
        )
        .once()
        .return_once(|_, _, _| Box::pin(async { Ok(ChannelSession::None) }));
    let mut bots = MockAgentBotLookup::new();
    bots.expect_has_agent()
        .with(mockall::predicate::eq(BotId::TEST_A))
        .once()
        .return_once(|_| Box::pin(async { Ok(true) }));
    let service = AgentTriggerService::new(sessions, bots);

    let events = service.evaluate(&posted).await.expect("evaluate message");
    assert_eq!(events.len(), 1);
    let AgentSessionTopicEvent::New(NewAgentSessionEvent::TopLevelMentioned(mentioned)) =
        &events[0].event().event
    else {
        panic!("expected a new-session event");
    };
    assert_eq!(mentioned.bot_id, BotId::TEST_A);
}

#[tokio::test]
async fn ignores_a_mentioned_bot_without_an_agent() {
    let posted = message(vec![mention_of(BotId::TEST_A)]);
    let mut sessions = MockAgentSessionRepo::new();
    sessions
        .expect_find_for_channel()
        .once()
        .return_once(|_, _, _| Box::pin(async { Ok(ChannelSession::None) }));
    let mut bots = MockAgentBotLookup::new();
    bots.expect_has_agent()
        .with(mockall::predicate::eq(BotId::TEST_A))
        .once()
        .return_once(|_| Box::pin(async { Ok(false) }));
    let service = AgentTriggerService::new(sessions, bots);

    assert!(
        service
            .evaluate(&posted)
            .await
            .expect("evaluate message")
            .is_empty()
    );
}

#[tokio::test]
async fn deduplicates_a_dedicated_session_found_for_multiple_mentions() {
    let posted = message(vec![mention_of(BotId::TEST_A), mention_of(BotId::TEST_B)]);
    let mut sessions = MockAgentSessionRepo::new();
    sessions
        .expect_find_for_channel()
        .times(2)
        .returning(|_, _, _| {
            Box::pin(async {
                Ok(ChannelSession::InDedicatedChannel(session(
                    AgentSessionId::TEST_A,
                    BotId::TEST_A,
                )))
            })
        });
    let mut bots = MockAgentBotLookup::new();
    bots.expect_has_agent()
        .with(mockall::predicate::eq(BotId::TEST_A))
        .once()
        .return_once(|_| Box::pin(async { Ok(true) }));
    let service = AgentTriggerService::new(sessions, bots);

    let events = service.evaluate(&posted).await.expect("evaluate message");
    assert_eq!(events.len(), 1);
    let AgentSessionTopicEvent::Existing(ExistingAgentSessionEvent::Channel(metadata)) =
        &events[0].event().event
    else {
        panic!("expected a channel event");
    };
    assert_eq!(metadata.session_id, AgentSessionId::TEST_A);
}
