use super::*;

fn call_message(first: bool) -> MessagePostedMetadata {
    let call_id = Uuid::from_u128(901);
    MessagePostedMetadata {
        parent: MessageParent::Call(call_id),
        message_id: if first { call_id } else { Uuid::from_u128(902) },
        thread_id: (!first).then_some(call_id),
        root_id: call_id,
        ..message(vec![mention_of(BotId::TEST_A)])
    }
}

#[tokio::test]
async fn system_mentions_in_first_and_later_call_messages_preserve_the_call_root() {
    for first in [true, false] {
        let posted = call_message(first);
        let mut history = MockThreadHistory::new();
        history
            .expect_authorize_invocation()
            .withf(|actor, parent, root| actor == &user() && parent == &MessageParent::Call(*root))
            .once()
            .returning(allow_invocation);
        let mut bots = MockAgentBotLookup::new();
        bots.expect_get_agent()
            .once()
            .return_once(|_| Box::pin(async { Ok(None) }));
        bots.expect_get_bot()
            .once()
            .return_once(|id| Box::pin(async move { Ok(Some(system_bot(id))) }));
        let (replies, judge) = no_implicit();
        let service = service_reading(sessions_without_existing(), bots, replies, judge, history);

        let events = service.evaluate(&posted).await.unwrap();
        let [TriggerDecision::Open { bot_id, message }] = events.as_slice() else {
            panic!("expected a new call agent session, got {events:?}");
        };
        assert_eq!(*bot_id, BotId::TEST_A);
        assert_eq!(message, &posted);
        assert_eq!(message.parent, MessageParent::Call(message.root_id()));
    }
}

#[tokio::test]
async fn call_mentions_require_the_private_agents_owner_for_either_channel_scope() {
    for scope in [AgentChannelScope::All, AgentChannelScope::Selected] {
        for is_owner in [true, false] {
            let mut posted = call_message(false);
            if !is_owner {
                posted.sender = ChannelSender::new_from_user(
                    MacroUserIdStr::try_from_email("outsider@example.com").unwrap(),
                );
            }
            let mut bots = MockAgentBotLookup::new();
            bots.expect_get_agent().once().return_once(move |id| {
                Box::pin(async move {
                    let mut agent = private_agent(id);
                    agent.channel_scope = scope;
                    Ok(Some(agent))
                })
            });

            assert_eq!(mention_yields_event(&posted, bots).await, is_owner);
        }
    }
}

#[tokio::test]
async fn call_mentions_require_membership_of_the_agents_team_for_either_channel_scope() {
    for scope in [AgentChannelScope::All, AgentChannelScope::Selected] {
        for is_member in [true, false] {
            let team_id = Uuid::from_u128(99);
            let mut facts = FactMocks::from(MockAgentBotLookup::new());
            facts.bots.expect_get_agent().once().return_once(move |id| {
                Box::pin(async move { Ok(Some(agent_with(id, BotOwner::Team { team_id }, scope))) })
            });
            facts
                .teams
                .expect_user_has_team()
                .with(
                    mockall::predicate::eq(user()),
                    mockall::predicate::eq(team_id),
                )
                .once()
                .return_once(move |_, _| Box::pin(async move { Ok(is_member) }));

            assert_eq!(
                mention_yields_event(&call_message(false), facts).await,
                is_member
            );
        }
    }
}

#[tokio::test]
async fn legacy_agent_backed_bots_in_calls_use_owner_authorization() {
    for is_owner in [true, false] {
        let mut posted = call_message(false);
        if !is_owner {
            posted.sender = ChannelSender::new_from_user(
                MacroUserIdStr::try_from_email("outsider@example.com").unwrap(),
            );
        }
        let mut bots = MockAgentBotLookup::new();
        bots.expect_get_agent()
            .once()
            .return_once(|_| Box::pin(async { Ok(None) }));
        bots.expect_get_bot().once().return_once(|id| {
            Box::pin(async move {
                Ok(Some(owned_bot(
                    id,
                    BotOwner::User {
                        user_id: user().to_string(),
                    },
                )))
            })
        });
        assert_eq!(mention_yields_event(&posted, bots).await, is_owner);
    }
}

#[tokio::test]
async fn removed_bots_and_bots_without_agents_cannot_be_invoked_in_calls() {
    for present in [true, false] {
        let mut bots = MockAgentBotLookup::new();
        bots.expect_get_agent()
            .once()
            .return_once(|_| Box::pin(async { Ok(None) }));
        bots.expect_get_bot().once().return_once(move |id| {
            Box::pin(async move {
                Ok(present.then(|| {
                    let mut bot = system_bot(id);
                    bot.has_agent = false;
                    bot
                }))
            })
        });
        assert!(!mention_yields_event(&call_message(false), bots).await);
    }
}

#[tokio::test]
async fn call_mentions_route_followups_to_the_session_at_the_call_root() {
    let posted = call_message(false);
    let mut existing = session(AgentSessionId::TEST_A, BotId::TEST_A);
    existing.thread_parent = Some(posted.parent.clone());
    existing.thread_id = Some(posted.root_id());
    let mut sessions = MockAgentSessionRepo::new();
    sessions
        .expect_find_for_thread()
        .with(
            mockall::predicate::eq(Some(posted.root_id())),
            mockall::predicate::eq(Some(BotId::TEST_A)),
        )
        .once()
        .return_once(move |_, _| {
            Box::pin(async move { Ok(ThreadSession::CreatedFromThread(existing)) })
        });
    let mut bots = MockAgentBotLookup::new();
    bots.expect_get_agent()
        .once()
        .return_once(|id| Box::pin(async move { Ok(Some(private_agent(id))) }));
    let (replies, judge) = no_implicit();

    let events = service(sessions, bots, replies, judge)
        .evaluate(&posted)
        .await
        .unwrap();
    let decision = existing_channel_metadata(&events);
    assert_eq!(decision.session_id, AgentSessionId::TEST_A);
    assert_eq!(decision.kind, ThreadMessageKind::MentionThread);
    assert_eq!(decision.message, posted);
}

#[tokio::test]
async fn queued_call_mentions_cannot_invoke_after_write_access_is_revoked() {
    let mut history = MockThreadHistory::new();
    history
        .expect_authorize_invocation()
        .once()
        .return_once(|_, _, _| Box::pin(async { Ok(None) }));
    let (replies, judge) = no_implicit();
    let service = service_reading(
        MockAgentSessionRepo::new(),
        MockAgentBotLookup::new(),
        replies,
        judge,
        history,
    );
    assert!(
        service
            .evaluate(&call_message(false))
            .await
            .unwrap()
            .is_empty()
    );
}
