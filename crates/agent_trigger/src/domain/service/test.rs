use super::*;

use agent_session::domain::error::AgentSessionError;
use agent_session::domain::model::{AgentSession, AgentSessionId, ChannelSession, SessionStatus};
use agent_session::domain::ports::MockAgentSessionRepo;
use bots::domain::models::{Agent, AgentChannelScope, Bot, BotKind, BotOwner};
use channel_sender::ChannelSender;
use channels::domain::models::{ChannelType, SimpleMention};
use chrono::Utc;
use macro_event_broker::MacroEvent;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;

use crate::domain::broker_events::{
    AgentTriggerTopicEvent, ExistingAgentSessionEvent, NewAgentSessionEvent,
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

fn owned_bot(bot_id: BotId, owner: BotOwner) -> Bot {
    Bot {
        id: bot_id,
        kind: BotKind::Owned,
        owner: Some(owner),
        name: format!("Agent {bot_id}"),
        handle: format!("agent-{bot_id}"),
        description: None,
        avatar_url: None,
        created_by: Some(user().as_ref().to_owned()),
        created_at: Utc::now(),
        updated_at: Utc::now(),
        deleted_at: None,
        has_agent: true,
    }
}

fn private_agent(bot_id: BotId) -> Agent {
    agent_with(
        bot_id,
        BotOwner::User {
            user_id: user().as_ref().to_owned(),
        },
        AgentChannelScope::All,
    )
}

fn agent_with(bot_id: BotId, owner: BotOwner, channel_scope: AgentChannelScope) -> Agent {
    Agent {
        bot: owned_bot(bot_id, owner),
        instructions: String::new(),
        harness: "in-memory".to_owned(),
        harness_id: None,
        default_model: "model".to_owned(),
        channel_scope,
        channel_ids: vec![],
    }
}

fn system_bot(bot_id: BotId) -> Bot {
    Bot {
        id: bot_id,
        kind: BotKind::System,
        owner: None,
        name: "System agent".to_owned(),
        handle: "system-agent".to_owned(),
        description: None,
        avatar_url: None,
        created_by: None,
        created_at: Utc::now(),
        updated_at: Utc::now(),
        deleted_at: None,
        has_agent: true,
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
        name: agent_session::domain::model::DEFAULT_AGENT_SESSION_NAME.to_owned(),
        owner_id: MacroUserIdStr::try_from_email("owner@example.com").expect("valid macro user id"),
        thread_id: None,
        thread_channel_id: None,
        originating_message_id: None,
        bot_id,
        model: "model".to_owned(),
        harness: "harness".to_owned(),
        repo_url: Some("https://example.com/repo".to_owned()),
        workspace: "/workspace".to_owned(),
        sandbox_size: agent_session::domain::model::SandboxSize::Default,
        instructions: None,
        acp_session_id: None,
        external: None,
        status: SessionStatus::NoMessages,
        created_at: Utc::now(),
        modified_at: Utc::now(),
    }
}

/// A session rooted at the test message's thread.
fn thread_session(id: AgentSessionId, bot_id: BotId) -> AgentSession {
    AgentSession {
        thread_id: Some(Uuid::from_u128(3)),
        originating_message_id: Some(Uuid::from_u128(3)),
        ..session(id, bot_id)
    }
}

type TestService = AgentTriggerService<
    MockAgentSessionRepo,
    MockAgentBotLookup,
    MockTeamMembershipLookup,
    MockChannelParticipationLookup,
    MockExplicitReplyExtractor,
    MockImplicitTriggerJudge,
    MockThreadHistory,
>;

/// Mocks holding the three fact ports one test scenario needs. Defaults to no
/// expectations, so any unplanned membership or participation call fails.
struct FactMocks {
    bots: MockAgentBotLookup,
    teams: MockTeamMembershipLookup,
    channels: MockChannelParticipationLookup,
}

impl From<MockAgentBotLookup> for FactMocks {
    fn from(bots: MockAgentBotLookup) -> Self {
        Self {
            bots,
            teams: MockTeamMembershipLookup::new(),
            channels: MockChannelParticipationLookup::new(),
        }
    }
}

/// A service over a thread that reads as empty; tests that care about thread
/// context pass their own history with [`service_reading`].
fn service(
    sessions: MockAgentSessionRepo,
    facts: impl Into<FactMocks>,
    replies: MockExplicitReplyExtractor,
    judge: MockImplicitTriggerJudge,
) -> TestService {
    service_reading(sessions, facts, replies, judge, thread_of(vec![]))
}

fn service_reading(
    sessions: MockAgentSessionRepo,
    facts: impl Into<FactMocks>,
    replies: MockExplicitReplyExtractor,
    judge: MockImplicitTriggerJudge,
    history: MockThreadHistory,
) -> TestService {
    let facts = facts.into();
    AgentTriggerService::new(
        sessions,
        facts.bots,
        facts.teams,
        facts.channels,
        replies,
        judge,
        history,
    )
}

/// A history that reads the given messages for any thread.
fn thread_of(messages: Vec<ThreadMessage>) -> MockThreadHistory {
    let mut history = MockThreadHistory::new();
    history.expect_thread_messages().returning(move |_, _| {
        let messages = messages.clone();
        Box::pin(async move { Ok(messages) })
    });
    history
}

/// Mocks for tests whose message never reaches the implicit path; any call is
/// a test failure.
fn no_implicit() -> (MockExplicitReplyExtractor, MockImplicitTriggerJudge) {
    (
        MockExplicitReplyExtractor::new(),
        MockImplicitTriggerJudge::new(),
    )
}

fn existing_channel_metadata(
    events: &[AgentSessionMacroEvent],
) -> &crate::domain::broker_events::ChannelEventMetadata {
    assert_eq!(events.len(), 1);
    let AgentTriggerTopicEvent::Existing(ExistingAgentSessionEvent::Channel(metadata)) =
        &events[0].event().event
    else {
        panic!("expected a channel event");
    };
    metadata
}

fn sessions_without_existing() -> MockAgentSessionRepo {
    let mut sessions = MockAgentSessionRepo::new();
    sessions
        .expect_find_for_channel()
        .once()
        .return_once(|_, _| Box::pin(async { Ok(ChannelSession::None) }));
    sessions
}

async fn mention_yields_event(
    posted: &ChannelMessagePostedMetadata,
    facts: impl Into<FactMocks>,
) -> bool {
    let (replies, judge) = no_implicit();
    !service(sessions_without_existing(), facts, replies, judge)
        .evaluate(posted)
        .await
        .expect("evaluate message")
        .is_empty()
}

#[tokio::test]
async fn a_private_global_agent_is_unavailable_to_another_user() {
    let mut posted = message(vec![mention_of(BotId::TEST_A)]);
    posted.sender = ChannelSender::new_from_user(
        MacroUserIdStr::try_from_email("outsider@example.com").expect("valid user id"),
    );
    let mut bots = MockAgentBotLookup::new();
    bots.expect_get_agent()
        .once()
        .return_once(|bot_id| Box::pin(async move { Ok(Some(private_agent(bot_id))) }));

    assert!(!mention_yields_event(&posted, bots).await);
}

#[tokio::test]
async fn a_bot_authored_mention_cannot_trigger_an_agent() {
    let mut posted = message(vec![mention_of(BotId::TEST_A)]);
    posted.sender = ChannelSender::new_from_bot(BotId::TEST_B);
    let bots = MockAgentBotLookup::new();

    assert!(!mention_yields_event(&posted, bots).await);
}

#[tokio::test]
async fn a_team_global_agent_is_available_to_a_team_member() {
    let team_id = Uuid::from_u128(99);
    let posted = message(vec![mention_of(BotId::TEST_A)]);
    let mut bots = MockAgentBotLookup::new();
    bots.expect_get_agent().once().return_once(move |bot_id| {
        Box::pin(async move {
            Ok(Some(agent_with(
                bot_id,
                BotOwner::Team { team_id },
                AgentChannelScope::All,
            )))
        })
    });
    let mut facts = FactMocks::from(bots);
    facts
        .teams
        .expect_user_has_team()
        .with(
            mockall::predicate::eq(user()),
            mockall::predicate::eq(team_id),
        )
        .once()
        .return_once(|_, _| Box::pin(async { Ok(true) }));

    assert!(mention_yields_event(&posted, facts).await);
}

#[tokio::test]
async fn a_team_global_agent_is_unavailable_outside_its_team() {
    let team_id = Uuid::from_u128(99);
    let posted = message(vec![mention_of(BotId::TEST_A)]);
    let mut bots = MockAgentBotLookup::new();
    bots.expect_get_agent().once().return_once(move |bot_id| {
        Box::pin(async move {
            Ok(Some(agent_with(
                bot_id,
                BotOwner::Team { team_id },
                AgentChannelScope::All,
            )))
        })
    });
    let mut facts = FactMocks::from(bots);
    facts
        .teams
        .expect_user_has_team()
        .once()
        .return_once(|_, _| Box::pin(async { Ok(false) }));

    assert!(!mention_yields_event(&posted, facts).await);
}

#[tokio::test]
async fn a_selected_agent_requires_active_channel_membership() {
    let posted = message(vec![mention_of(BotId::TEST_A)]);
    let mut bots = MockAgentBotLookup::new();
    bots.expect_get_agent().once().return_once(|bot_id| {
        Box::pin(async move {
            Ok(Some(agent_with(
                bot_id,
                BotOwner::User {
                    user_id: "macro|some-owner@example.com".to_owned(),
                },
                AgentChannelScope::Selected,
            )))
        })
    });
    let mut facts = FactMocks::from(bots);
    facts
        .channels
        .expect_bot_active_in_channel()
        .with(
            mockall::predicate::eq(posted.channel_id),
            mockall::predicate::eq(BotId::TEST_A),
        )
        .once()
        .return_once(|_, _| Box::pin(async { Ok(false) }));

    assert!(!mention_yields_event(&posted, facts).await);
}

#[tokio::test]
async fn an_active_selected_agent_is_available_to_channel_members() {
    let posted = message(vec![mention_of(BotId::TEST_A)]);
    let mut bots = MockAgentBotLookup::new();
    bots.expect_get_agent().once().return_once(|bot_id| {
        Box::pin(async move {
            Ok(Some(agent_with(
                bot_id,
                BotOwner::User {
                    user_id: "macro|some-owner@example.com".to_owned(),
                },
                AgentChannelScope::Selected,
            )))
        })
    });
    let mut facts = FactMocks::from(bots);
    facts
        .channels
        .expect_bot_active_in_channel()
        .with(
            mockall::predicate::eq(posted.channel_id),
            mockall::predicate::eq(BotId::TEST_A),
        )
        .once()
        .return_once(|_, _| Box::pin(async { Ok(true) }));

    assert!(mention_yields_event(&posted, facts).await);
}

#[tokio::test]
async fn a_system_agent_is_available_without_channel_membership() {
    let posted = message(vec![mention_of(BotId::TEST_A)]);
    let mut bots = MockAgentBotLookup::new();
    bots.expect_get_agent()
        .once()
        .return_once(|_| Box::pin(async { Ok(None) }));
    bots.expect_get_bot()
        .once()
        .return_once(|bot_id| Box::pin(async move { Ok(Some(system_bot(bot_id))) }));

    assert!(mention_yields_event(&posted, bots).await);
}

#[tokio::test]
async fn forwards_a_mentioned_thread_reply_to_its_session() {
    let posted = message(vec![mention_of(BotId::TEST_A)]);
    let mut sessions = MockAgentSessionRepo::new();
    sessions
        .expect_find_for_channel()
        .with(
            mockall::predicate::eq(posted.thread_id),
            mockall::predicate::eq(Some(BotId::TEST_A)),
        )
        .once()
        .return_once(|_, _| {
            Box::pin(async {
                Ok(ChannelSession::CreatedFromThread(session(
                    AgentSessionId::TEST_A,
                    BotId::TEST_A,
                )))
            })
        });
    let mut bots = MockAgentBotLookup::new();
    bots.expect_get_agent()
        .with(mockall::predicate::eq(BotId::TEST_A))
        .once()
        .return_once(|bot_id| Box::pin(async move { Ok(Some(private_agent(bot_id))) }));
    let (replies, judge) = no_implicit();
    let service = service(sessions, bots, replies, judge);

    let events = service.evaluate(&posted).await.expect("evaluate message");
    let metadata = existing_channel_metadata(&events);
    assert_eq!(metadata.bot_id, BotId::TEST_A);
    assert_eq!(metadata.session_id, AgentSessionId::TEST_A);
}

/// A reply in a session's originating thread that does not mention the bot
/// stays a normal channel message.
#[tokio::test]
async fn a_thread_reply_without_a_mention_does_not_forward() {
    let posted = message(vec![]);
    let sessions = implicit_sessions(vec![]);
    let (replies, judge) = no_implicit();
    let service = service(sessions, MockAgentBotLookup::new(), replies, judge);

    assert!(
        service
            .evaluate(&posted)
            .await
            .expect("evaluate message")
            .is_empty()
    );
}

#[tokio::test]
async fn evaluates_every_mentioned_agent_bot() {
    let posted = message(vec![mention_of(BotId::TEST_B), mention_of(BotId::TEST_A)]);
    let thread_id = posted.thread_id;
    let mut sessions = MockAgentSessionRepo::new();
    sessions
        .expect_find_for_channel()
        .withf(move |actual_thread_id, bot_id| *actual_thread_id == thread_id && bot_id.is_some())
        .times(2)
        .returning(|_, _| Box::pin(async { Ok(ChannelSession::None) }));
    let mut bots = MockAgentBotLookup::new();
    bots.expect_get_agent()
        .times(2)
        .returning(|bot_id| Box::pin(async move { Ok(Some(private_agent(bot_id))) }));
    let (replies, judge) = no_implicit();
    let service = service(sessions, bots, replies, judge);

    let events = service.evaluate(&posted).await.expect("evaluate message");
    assert_eq!(events.len(), 2);
    let mut event_bots: Vec<_> = events
        .iter()
        .map(|event| match &event.event().event {
            AgentTriggerTopicEvent::New(NewAgentSessionEvent::TopLevelMentioned(mentioned)) => {
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
            mockall::predicate::eq(posted.thread_id),
            mockall::predicate::eq(Some(BotId::TEST_A)),
        )
        .once()
        .return_once(|_, _| Box::pin(async { Ok(ChannelSession::None) }));
    let mut bots = MockAgentBotLookup::new();
    bots.expect_get_agent()
        .with(mockall::predicate::eq(BotId::TEST_A))
        .once()
        .return_once(|bot_id| Box::pin(async move { Ok(Some(private_agent(bot_id))) }));
    let (replies, judge) = no_implicit();
    let service = service(sessions, bots, replies, judge);

    let events = service.evaluate(&posted).await.expect("evaluate message");
    assert_eq!(events.len(), 1);
    let AgentTriggerTopicEvent::New(NewAgentSessionEvent::TopLevelMentioned(mentioned)) =
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
        .return_once(|_, _| Box::pin(async { Ok(ChannelSession::None) }));
    let mut bots = MockAgentBotLookup::new();
    bots.expect_get_agent()
        .with(mockall::predicate::eq(BotId::TEST_A))
        .once()
        .return_once(|_| Box::pin(async { Ok(None) }));
    bots.expect_get_bot()
        .with(mockall::predicate::eq(BotId::TEST_A))
        .once()
        .return_once(|_| Box::pin(async { Ok(None) }));
    let (replies, judge) = no_implicit();
    let service = service(sessions, bots, replies, judge);

    assert!(
        service
            .evaluate(&posted)
            .await
            .expect("evaluate message")
            .is_empty()
    );
}

#[tokio::test]
async fn deduplicates_a_session_found_for_multiple_mentions() {
    let posted = message(vec![mention_of(BotId::TEST_A), mention_of(BotId::TEST_B)]);
    let mut sessions = MockAgentSessionRepo::new();
    sessions
        .expect_find_for_channel()
        .times(2)
        .returning(|_, _| {
            Box::pin(async {
                Ok(ChannelSession::CreatedFromThread(session(
                    AgentSessionId::TEST_A,
                    BotId::TEST_A,
                )))
            })
        });
    let mut bots = MockAgentBotLookup::new();
    bots.expect_get_agent()
        .with(mockall::predicate::eq(BotId::TEST_A))
        .once()
        .return_once(|bot_id| Box::pin(async move { Ok(Some(private_agent(bot_id))) }));
    let (replies, judge) = no_implicit();
    let service = service(sessions, bots, replies, judge);

    let events = service.evaluate(&posted).await.expect("evaluate message");
    let metadata = existing_channel_metadata(&events);
    assert_eq!(metadata.session_id, AgentSessionId::TEST_A);
}

/// Session repo mocks for the implicit path: no session owns the message's
/// channel, and its thread carries the given sessions.
fn implicit_sessions(found: Vec<AgentSession>) -> MockAgentSessionRepo {
    let mut sessions = MockAgentSessionRepo::new();
    sessions
        .expect_find_for_channel()
        .once()
        .return_once(|_, _| Box::pin(async { Ok(ChannelSession::None) }));
    sessions
        .expect_find_all_for_thread()
        .with(mockall::predicate::eq(Uuid::from_u128(3)))
        .once()
        .return_once(move |_| Box::pin(async move { Ok(found) }));
    sessions
}

fn agent_bots() -> MockAgentBotLookup {
    let mut bots = MockAgentBotLookup::new();
    bots.expect_get_agent()
        .returning(|bot_id| Box::pin(async move { Ok(Some(private_agent(bot_id))) }));
    bots
}

fn extractor(result: Result<Option<ExtractedExplicitReply>>) -> MockExplicitReplyExtractor {
    let mut replies = MockExplicitReplyExtractor::new();
    replies
        .expect_extract_explicit_reply()
        .once()
        .return_once(move |_| Box::pin(async move { result }));
    replies
}

fn reply_to_bot(bot_id: BotId) -> ExtractedExplicitReply {
    ExtractedExplicitReply {
        channel_id: Uuid::from_u128(1).to_string(),
        target_message_id: Uuid::from_u128(10).to_string(),
        target_thread_id: Uuid::from_u128(3).to_string(),
        display_text: "please fix this".to_owned(),
        sender_id: bot_id.into_storage_id().as_ref().to_owned(),
    }
}

fn reply_to_user() -> ExtractedExplicitReply {
    reply_to_user_message(Uuid::from_u128(10))
}

fn reply_to_user_message(target_message_id: Uuid) -> ExtractedExplicitReply {
    ExtractedExplicitReply {
        channel_id: Uuid::from_u128(1).to_string(),
        target_message_id: target_message_id.to_string(),
        target_thread_id: Uuid::from_u128(3).to_string(),
        display_text: "please fix this".to_owned(),
        sender_id: user().as_ref().to_owned(),
    }
}

fn judge_saying(result: Result<bool>) -> MockImplicitTriggerJudge {
    let mut judge = MockImplicitTriggerJudge::new();
    judge
        .expect_is_addressed_to_agent()
        .once()
        .return_once(move |_, _| Box::pin(async move { result }));
    judge
}

/// A judge that asserts on the transcript it was handed, and says yes.
fn judge_expecting(transcript: &'static str) -> MockImplicitTriggerJudge {
    let mut judge = MockImplicitTriggerJudge::new();
    judge
        .expect_is_addressed_to_agent()
        .once()
        .return_once(move |_, given| {
            assert_eq!(given, transcript);
            Box::pin(async { Ok(true) })
        });
    judge
}

fn thread_message(id: u128, sender: ChannelSender<'static>, content: &str) -> ThreadMessage {
    ThreadMessage {
        id: Uuid::from_u128(id),
        sender,
        content: content.to_owned(),
        created_at: Utc::now(),
    }
}

#[tokio::test]
async fn an_explicit_reply_in_a_session_thread_triggers_without_a_mention() {
    let posted = message(vec![]);
    let sessions = implicit_sessions(vec![thread_session(AgentSessionId::TEST_A, BotId::TEST_A)]);
    let service = service(
        sessions,
        agent_bots(),
        extractor(Ok(Some(reply_to_bot(BotId::TEST_A)))),
        MockImplicitTriggerJudge::new(),
    );

    let events = service.evaluate(&posted).await.expect("evaluate message");
    let metadata = existing_channel_metadata(&events);
    assert_eq!(metadata.session_id, AgentSessionId::TEST_A);
    assert_eq!(metadata.bot_id, BotId::TEST_A);
    assert_eq!(metadata.kind, ChannelKind::ExplicitReply);
}

#[tokio::test]
async fn a_message_the_judge_reads_as_addressed_triggers_as_inferred() {
    let posted = message(vec![]);
    let sessions = implicit_sessions(vec![thread_session(AgentSessionId::TEST_A, BotId::TEST_A)]);
    let service = service(
        sessions,
        agent_bots(),
        extractor(Ok(None)),
        judge_saying(Ok(true)),
    );

    let events = service.evaluate(&posted).await.expect("evaluate message");
    let metadata = existing_channel_metadata(&events);
    assert_eq!(metadata.kind, ChannelKind::Inferred);
}

#[tokio::test]
async fn a_message_addressed_to_nobody_yields_nothing() {
    let posted = message(vec![]);
    let sessions = implicit_sessions(vec![thread_session(AgentSessionId::TEST_A, BotId::TEST_A)]);
    let service = service(
        sessions,
        agent_bots(),
        extractor(Ok(None)),
        judge_saying(Ok(false)),
    );

    assert!(
        service
            .evaluate(&posted)
            .await
            .expect("evaluate message")
            .is_empty()
    );
}

#[tokio::test]
async fn a_thread_without_sessions_never_consults_the_judge() {
    let posted = message(vec![]);
    let sessions = implicit_sessions(vec![]);
    let (replies, judge) = no_implicit();
    let service = service(sessions, MockAgentBotLookup::new(), replies, judge);

    assert!(
        service
            .evaluate(&posted)
            .await
            .expect("evaluate message")
            .is_empty()
    );
}

#[tokio::test]
async fn a_bot_sender_never_triggers_implicitly() {
    let mut posted = message(vec![]);
    posted.sender = ChannelSender::new_from_bot(BotId::TEST_B);
    let mut sessions = MockAgentSessionRepo::new();
    sessions
        .expect_find_for_channel()
        .once()
        .return_once(|_, _| Box::pin(async { Ok(ChannelSession::None) }));
    let (replies, judge) = no_implicit();
    let service = service(sessions, MockAgentBotLookup::new(), replies, judge);

    assert!(
        service
            .evaluate(&posted)
            .await
            .expect("evaluate message")
            .is_empty()
    );
}

#[tokio::test]
async fn implicit_triggering_skips_sessions_of_agentless_bots() {
    let posted = message(vec![]);
    let sessions = implicit_sessions(vec![
        thread_session(AgentSessionId::TEST_A, BotId::TEST_A),
        thread_session(AgentSessionId::TEST_B, BotId::TEST_B),
    ]);
    let mut bots = MockAgentBotLookup::new();
    bots.expect_get_agent()
        .with(mockall::predicate::eq(BotId::TEST_A))
        .once()
        .return_once(|_| Box::pin(async { Ok(None) }));
    bots.expect_get_agent()
        .with(mockall::predicate::eq(BotId::TEST_B))
        .once()
        .return_once(|bot_id| Box::pin(async move { Ok(Some(private_agent(bot_id))) }));
    bots.expect_get_bot()
        .with(mockall::predicate::eq(BotId::TEST_A))
        .once()
        .return_once(|_| Box::pin(async { Ok(None) }));
    let service = service(
        sessions,
        bots,
        extractor(Ok(Some(reply_to_bot(BotId::TEST_B)))),
        MockImplicitTriggerJudge::new(),
    );

    let events = service.evaluate(&posted).await.expect("evaluate message");
    let metadata = existing_channel_metadata(&events);
    assert_eq!(metadata.session_id, AgentSessionId::TEST_B);
    assert_eq!(metadata.bot_id, BotId::TEST_B);
}

#[tokio::test]
async fn two_live_agents_in_a_thread_yield_nothing() {
    let posted = message(vec![]);
    let sessions = implicit_sessions(vec![
        thread_session(AgentSessionId::TEST_A, BotId::TEST_A),
        thread_session(AgentSessionId::TEST_B, BotId::TEST_B),
    ]);
    let service = service(
        sessions,
        agent_bots(),
        extractor(Ok(None)),
        MockImplicitTriggerJudge::new(),
    );

    assert!(
        service
            .evaluate(&posted)
            .await
            .expect("evaluate message")
            .is_empty()
    );
}

#[tokio::test]
async fn a_failing_extractor_falls_through_to_the_judge() {
    let posted = message(vec![]);
    let sessions = implicit_sessions(vec![thread_session(AgentSessionId::TEST_A, BotId::TEST_A)]);
    let service = service(
        sessions,
        agent_bots(),
        extractor(Err(AgentSessionError::Unknown(anyhow::anyhow!(
            "lexical service unavailable"
        )))),
        judge_saying(Ok(true)),
    );

    let events = service.evaluate(&posted).await.expect("evaluate message");
    assert_eq!(
        existing_channel_metadata(&events).kind,
        ChannelKind::Inferred
    );
}

#[tokio::test]
async fn a_failing_judge_yields_nothing_instead_of_an_error() {
    let posted = message(vec![]);
    let sessions = implicit_sessions(vec![thread_session(AgentSessionId::TEST_A, BotId::TEST_A)]);
    let service = service(
        sessions,
        agent_bots(),
        extractor(Ok(None)),
        judge_saying(Err(AgentSessionError::Unknown(anyhow::anyhow!(
            "model unavailable"
        )))),
    );

    assert!(
        service
            .evaluate(&posted)
            .await
            .expect("evaluate message")
            .is_empty()
    );
}

#[tokio::test]
async fn the_judge_reads_the_thread_around_the_agent() {
    let posted = message(vec![]);
    let sessions = implicit_sessions(vec![thread_session(AgentSessionId::TEST_A, BotId::TEST_A)]);
    // Message 2 is the one being evaluated, so both it and the agent's own
    // message anchor a window; message 0 falls outside both.
    let history = thread_of(vec![
        thread_message(0, ChannelSender::new_from_user(user()), "unrelated chatter"),
        thread_message(1, ChannelSender::new_from_bot(BotId::TEST_A), "on it"),
        thread_message(2, ChannelSender::new_from_user(user()), "hello"),
    ]);
    let service = service_reading(
        sessions,
        agent_bots(),
        extractor(Ok(None)),
        judge_expecting(
            "[user macro|trigger-service-test@macro.com] unrelated chatter\n\
             [agent] on it\n\
             [user macro|trigger-service-test@macro.com] hello\n",
        ),
        history,
    );

    let events = service.evaluate(&posted).await.expect("evaluate message");
    assert_eq!(
        existing_channel_metadata(&events).kind,
        ChannelKind::Inferred
    );
}

#[tokio::test]
async fn an_explicit_reply_never_reads_the_thread() {
    let posted = message(vec![]);
    let sessions = implicit_sessions(vec![thread_session(AgentSessionId::TEST_A, BotId::TEST_A)]);
    let mut history = MockThreadHistory::new();
    history.expect_thread_messages().never();
    let service = service_reading(
        sessions,
        agent_bots(),
        extractor(Ok(Some(reply_to_bot(BotId::TEST_A)))),
        MockImplicitTriggerJudge::new(),
        history,
    );

    let events = service.evaluate(&posted).await.expect("evaluate message");
    assert_eq!(
        existing_channel_metadata(&events).kind,
        ChannelKind::ExplicitReply
    );
}

#[tokio::test]
async fn an_unreadable_thread_still_judges_the_message_alone() {
    let posted = message(vec![]);
    let sessions = implicit_sessions(vec![thread_session(AgentSessionId::TEST_A, BotId::TEST_A)]);
    let mut history = MockThreadHistory::new();
    history.expect_thread_messages().once().return_once(|_, _| {
        Box::pin(async {
            Err(AgentSessionError::Unknown(anyhow::anyhow!(
                "channels database unavailable"
            )))
        })
    });
    let service = service_reading(
        sessions,
        agent_bots(),
        extractor(Ok(None)),
        judge_expecting(""),
        history,
    );

    let events = service.evaluate(&posted).await.expect("evaluate message");
    assert_eq!(
        existing_channel_metadata(&events).kind,
        ChannelKind::Inferred
    );
}

#[tokio::test]
async fn an_explicit_reply_to_the_originating_message_triggers_without_a_mention() {
    let posted = message(vec![]);
    let sessions = implicit_sessions(vec![thread_session(AgentSessionId::TEST_A, BotId::TEST_A)]);
    let service = service(
        sessions,
        agent_bots(),
        extractor(Ok(Some(reply_to_user_message(Uuid::from_u128(3))))),
        MockImplicitTriggerJudge::new(),
    );

    let events = service.evaluate(&posted).await.expect("evaluate message");
    let metadata = existing_channel_metadata(&events);
    assert_eq!(metadata.session_id, AgentSessionId::TEST_A);
    assert_eq!(metadata.bot_id, BotId::TEST_A);
    assert_eq!(metadata.kind, ChannelKind::ExplicitReply);
}

#[tokio::test]
async fn an_explicit_reply_to_another_user_falls_through_to_the_judge() {
    let posted = message(vec![]);
    let sessions = implicit_sessions(vec![thread_session(AgentSessionId::TEST_A, BotId::TEST_A)]);
    let service = service(
        sessions,
        agent_bots(),
        extractor(Ok(Some(reply_to_user()))),
        judge_saying(Ok(true)),
    );

    let events = service.evaluate(&posted).await.expect("evaluate message");
    assert_eq!(
        existing_channel_metadata(&events).kind,
        ChannelKind::Inferred
    );
}

#[tokio::test]
async fn an_explicit_reply_to_one_of_two_live_agents_routes_to_that_agent() {
    let posted = message(vec![]);
    let sessions = implicit_sessions(vec![
        thread_session(AgentSessionId::TEST_A, BotId::TEST_A),
        thread_session(AgentSessionId::TEST_B, BotId::TEST_B),
    ]);
    let service = service(
        sessions,
        agent_bots(),
        extractor(Ok(Some(reply_to_bot(BotId::TEST_B)))),
        MockImplicitTriggerJudge::new(),
    );

    let events = service.evaluate(&posted).await.expect("evaluate message");
    let metadata = existing_channel_metadata(&events);
    assert_eq!(metadata.session_id, AgentSessionId::TEST_B);
    assert_eq!(metadata.bot_id, BotId::TEST_B);
    assert_eq!(metadata.kind, ChannelKind::ExplicitReply);
}

#[tokio::test]
async fn an_explicit_reply_to_neither_of_two_live_agents_yields_nothing() {
    let posted = message(vec![]);
    let sessions = implicit_sessions(vec![
        thread_session(AgentSessionId::TEST_A, BotId::TEST_A),
        thread_session(AgentSessionId::TEST_B, BotId::TEST_B),
    ]);
    let service = service(
        sessions,
        agent_bots(),
        extractor(Ok(Some(reply_to_user()))),
        MockImplicitTriggerJudge::new(),
    );

    assert!(
        service
            .evaluate(&posted)
            .await
            .expect("evaluate message")
            .is_empty()
    );
}

#[tokio::test]
async fn an_explicit_reply_to_a_shared_originating_message_yields_nothing() {
    let posted = message(vec![]);
    let sessions = implicit_sessions(vec![
        thread_session(AgentSessionId::TEST_A, BotId::TEST_A),
        thread_session(AgentSessionId::TEST_B, BotId::TEST_B),
    ]);
    let service = service(
        sessions,
        agent_bots(),
        extractor(Ok(Some(reply_to_user_message(Uuid::from_u128(3))))),
        MockImplicitTriggerJudge::new(),
    );

    assert!(
        service
            .evaluate(&posted)
            .await
            .expect("evaluate message")
            .is_empty()
    );
}
