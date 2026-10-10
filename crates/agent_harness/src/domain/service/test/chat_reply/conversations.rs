use super::*;
use crate::domain::model::ReplyPlacement;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

fn direct_command() -> OpenSession {
    let mut command = chat_open_command();
    mention_origin_mut(&mut command).reply_placement = ReplyPlacement::Timeline;
    command
}

fn conversation(
    channel: macro_uuid::Uuid,
    command: &OpenSession,
) -> agent_session::domain::agent_conversation::AgentConversation {
    agent_session::domain::agent_conversation::AgentConversation {
        channel_id: channel,
        bot_id: command.bot_id,
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn quota_denial_finishes_queued_conversation_turns_without_stopping_the_running_turn(
    pool: sqlx::PgPool,
) {
    use crate::domain::conversation_turns::{ConversationTurnState, ConversationTurnStore};
    use agent_session::domain::agent_conversation::AgentConversationRepo;
    use channels::domain::agent_dm::AgentDmRepo;

    let journal =
        Arc::new(crate::outbound::conversation_turns::PgConversationTurnStore::new(pool.clone()));
    let ((service, _, containers, announcer, _), _) = harness_with_ports_and_journal(
        PromptContextMock::default(),
        PromptComposerMock::default(),
        KindDefaultPolicies,
        HarnessDefaultCodingAgents,
        PromptMentionsMock::new(),
        Some(journal.clone()),
    );
    let mut command = direct_command();
    let channel = channels::outbound::pg_channels_repo::PgChannelsRepo::new(pool.clone())
        .ensure(mention_origin(&command).sender.clone(), command.bot_id)
        .await
        .unwrap()
        .dm
        .channel_id;
    let session = crate::testing::postgres_sessions(pool)
        .current_or_create(conversation(channel, &command))
        .await
        .unwrap();
    mention_origin_mut(&mut command).parent = MessageParent::Channel(channel);
    let running_source = mention_origin(&command).message_id;
    let _container = open_direct(&service, &containers, session, command.clone()).await;
    let mut queued = Vec::new();
    for _ in 0..2 {
        let source = macro_uuid::generate_uuid_v7();
        mention_origin_mut(&mut command).message_id = source;
        queued.push(source);
        assert_eq!(
            service
                .execute(
                    session,
                    HarnessCommand::ConversationMessage(command.clone())
                )
                .await
                .unwrap(),
            CommandOutcome::Queued,
        );
    }
    service
        .inner
        .reject_waiting_on_denial(
            session,
            &HarnessError::Admission(ai_billing::AiAdmissionError::Denied(
                ai_billing::DenyReason::AllowanceExhausted,
            )),
        )
        .await
        .unwrap();

    for source in queued {
        let record = journal.get(source, command.bot_id).await.unwrap().unwrap();
        assert_eq!(record.state, ConversationTurnState::Failed);
        assert!(record.reply_finalized);
    }
    assert_eq!(
        journal
            .get(running_source, command.bot_id)
            .await
            .unwrap()
            .unwrap()
            .state,
        ConversationTurnState::Running
    );
    assert!(service.inner.busy.turn(session).is_some());
    assert!(service.inner.queues.snapshot(session).is_empty());
    assert!(
        service
            .inner
            .sessions
            .list_queued_actions(session)
            .await
            .unwrap()
            .is_empty()
    );
    assert!(
        announcer.resolved().is_empty(),
        "the active reply is still running"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_message_whose_conversation_was_deleted_is_acknowledged_instead_of_redelivered(
    pool: sqlx::PgPool,
) {
    use agent_session::domain::agent_conversation::AgentConversationRepo;
    use channels::domain::{agent_dm::AgentDmRepo, ports::ChannelRepo};
    let journal =
        Arc::new(crate::outbound::conversation_turns::PgConversationTurnStore::new(pool.clone()));
    let policy = Arc::new(
        crate::domain::conversations::AgentConversationsService::new(
            channels::outbound::pg_channels_repo::PgChannelsRepo::new(pool.clone()),
            bots::domain::service::BotServiceImpl::new(
                bots::outbound::pg_bots_repo::PgBotsRepo::new(pool.clone()),
                macro_event_broker::NoopMacroEventBroker,
            ),
            bots::outbound::pg_bots_repo::PgBotsRepo::new(pool.clone()),
            crate::testing::postgres_sessions(pool.clone()),
        )
        .with_turns(journal.clone()),
    );
    let ((service, ..), _) = harness_with_journal_and_policy(
        PromptContextMock::default(),
        PromptComposerMock::default(),
        KindDefaultPolicies,
        HarnessDefaultCodingAgents,
        PromptMentionsMock::new(),
        Some(journal),
        Some(policy),
    );
    let mut command = direct_command();
    let owner = mention_origin(&command).sender.clone();
    let channels = channels::outbound::pg_channels_repo::PgChannelsRepo::new(pool.clone());
    let channel = channels
        .ensure(owner.clone(), command.bot_id)
        .await
        .unwrap()
        .dm
        .channel_id;
    let session = crate::testing::postgres_sessions(pool)
        .current_or_create(conversation(channel, &command))
        .await
        .unwrap();
    mention_origin_mut(&mut command).parent = MessageParent::Channel(channel);
    let (admitted, _) = service
        .admit_conversation_message(session, command.clone())
        .await
        .unwrap()
        .expect("a live conversation admits its owner's message");
    assert_eq!(admitted, session);

    // Deleted after the trigger published the next message: the session row
    // went with the channel, and every redelivery would be refused alike.
    channels
        .delete_channel(channel, owner.to_string())
        .await
        .unwrap();
    mention_origin_mut(&mut command).message_id = macro_uuid::generate_uuid_v7();
    assert!(
        service
            .admit_conversation_message(session, command)
            .await
            .unwrap()
            .is_none()
    );
}

async fn open_direct(
    service: &TestHarness,
    containers: &MockContainerManager,
    id: AgentSessionId,
    command: OpenSession,
) -> ContainerMock {
    let open = service.execute(id, HarnessCommand::ConversationMessage(command));
    let drive = async {
        while containers.spawned() == 0 {
            tokio::task::yield_now().await;
        }
        let container = containers.container(session_of(containers)).unwrap();
        complete_session_handshake(&container).await;
        container.agent().wait_for_requests(3).await;
        container
    };
    let (result, container) = tokio::join!(open, drive);
    result.expect("the reserved DM session opens");
    container
}

#[tokio::test]
async fn direct_conversations_share_one_session_queue_in_order_and_answer_in_the_timeline() {
    let ((service, sessions, containers, announcer, _), turns) =
        harness_with_signals(PromptContextMock::default(), PromptComposerMock::default());
    let id = AgentSessionId::new();
    let first = direct_command();
    let container = open_direct(&service, &containers, id, first.clone()).await;
    let agent = container.agent();
    let mut next = first.clone();
    mention_origin_mut(&mut next).message_id = macro_uuid::generate_uuid_v7();
    mention_origin_mut(&mut next).thread_id = mention_origin(&next).message_id;
    mention_origin_mut(&mut next).content = "Follow up".to_owned();
    let outcome = service
        .execute(id, HarnessCommand::ConversationMessage(next))
        .await
        .unwrap();
    assert_eq!(outcome, CommandOutcome::Queued);
    assert_eq!(containers.spawned(), 1);
    assert!(
        agent.received_notifications().is_empty(),
        "a DM follow-up must not cancel the current turn"
    );
    assert!(
        announcer.announced().is_empty(),
        "a private reply posts nothing until the agent has something to show"
    );
    assert!(
        matches!(announcer.typed().as_slice(), [typing] if typing.active && typing.thread_id.is_none()),
        "the bot types in the timeline while the first turn runs: {:#?}",
        announcer.typed()
    );
    assert!(
        sessions.get(id).await.unwrap().thread_id.is_none(),
        "the whole DM owns the conversation, not its first message's thread"
    );
    says(&agent, "First answer.");
    agent.completes_prompt().await;
    turns.lifecycle_published(4).await;
    assert_eq!(answers(&announcer), ["First answer."]);
    says(&agent, "Second answer.");
    agent.completes_prompt().await;
    turns.lifecycle_published(6).await;
    assert_eq!(answers(&announcer), ["First answer.", "Second answer."]);
    assert!(
        announcer
            .presented()
            .iter()
            .all(|reply| reply.thread_id.is_none() && !reply.link),
        "a private reply is top-level and repeats no session link"
    );
    assert!(announcer.announced().is_empty());
}

/// The text of each final reply message shown, in order: the answers.
fn answers(announcer: &AnnouncerMock) -> Vec<String> {
    announcer
        .presented()
        .iter()
        .filter(|reply| reply.notify)
        .filter_map(|reply| {
            reply
                .segments
                .iter()
                .rev()
                .find_map(|segment| segment.text.clone())
        })
        .collect()
}

#[tokio::test]
async fn a_private_reply_posts_each_passage_with_its_steps_and_only_the_answer_is_news() {
    use agent_fold::domain::model::{SegmentKind, TurnPhase};
    let ((service, _, containers, announcer, _), turns) =
        harness_with_signals(PromptContextMock::default(), PromptComposerMock::default());
    let id = AgentSessionId::new();
    let container = open_direct(&service, &containers, id, direct_command()).await;
    let agent = container.agent();

    says(&agent, "Checking the tests first.");
    eventually("the agent is seen writing", || {
        announcer
            .typed()
            .iter()
            .any(|typing| typing.phase == TurnPhase::Writing)
    })
    .await;
    assert!(
        announcer.presented().is_empty(),
        "an unfinished passage streams live and is not posted"
    );

    runs(&agent, "t1", "in_progress", "cargo test");
    eventually("the narration is posted with its open steps", || {
        !announcer.presented().is_empty()
    })
    .await;
    let narration = announcer.presented()[0].clone();
    assert!(!narration.notify, "narration is not news");
    assert_eq!(
        narration
            .segments
            .iter()
            .map(|segment| (segment.segment.kind, segment.segment.sealed))
            .collect::<Vec<_>>(),
        [(SegmentKind::Prose, true), (SegmentKind::Activity, false)]
    );
    assert_eq!(
        narration.segments[0].text.as_deref(),
        Some("Checking the tests first.")
    );
    assert!(
        announcer
            .typed()
            .iter()
            .any(|typing| typing.phase == TurnPhase::Working),
        "the bot says it is working while the step runs"
    );

    finishes(&agent, "t1");
    says(&agent, "All green.");
    agent.completes_prompt().await;
    turns.lifecycle_published(4).await;

    let presented = announcer.presented();
    let finals: Vec<_> = presented.iter().filter(|reply| reply.notify).collect();
    assert_eq!(finals.len(), 1, "{presented:#?}");
    assert_eq!(
        finals[0]
            .segments
            .last()
            .and_then(|segment| segment.text.as_deref()),
        Some("All green.")
    );
    assert_ne!(
        finals[0].message_id, narration.message_id,
        "the answer is a message of its own"
    );
    // The narration's message is rewritten once its steps sealed, never posted twice.
    let narration_updates: Vec<_> = presented
        .iter()
        .filter(|reply| reply.message_id == narration.message_id)
        .collect();
    assert!(
        narration_updates
            .last()
            .unwrap()
            .segments
            .iter()
            .all(|segment| segment.segment.sealed)
    );
    assert!(
        matches!(announcer.typed().last(), Some(typing) if !typing.active),
        "the bot stops typing once the answer is showing"
    );
}

#[tokio::test]
async fn a_different_person_cannot_prompt_the_reserved_direct_session() {
    let ((service, _, containers, announcer, _), _) =
        harness_with_signals(PromptContextMock::default(), PromptComposerMock::default());
    let id = AgentSessionId::new();
    let mut command = direct_command();
    let _container = open_direct(&service, &containers, id, command.clone()).await;
    mention_origin_mut(&mut command).sender = staff_sender();
    mention_origin_mut(&mut command).message_id = macro_uuid::generate_uuid_v7();
    assert!(matches!(
        service
            .execute(id, HarnessCommand::ConversationMessage(command))
            .await,
        Err(HarnessError::Session(AgentSessionError::Forbidden))
    ));
    assert!(announcer.announced().is_empty());
    assert!(announcer.presented().is_empty());
}

#[tokio::test]
async fn an_external_persona_conversation_binds_the_connected_runtime_without_spawning_a_container()
{
    let (service, repo, containers, announcer, runtimes) = harness();
    let id = AgentSessionId::new();
    let mut command = direct_command();
    command.bot_id = BotId::new_from_uuid(macro_uuid::generate_uuid_v7());
    command.runtime.kind = AgentKind::External;
    command.runtime.harness = "external".to_owned();
    let runtime = ContainerMock::default();
    runtimes.attach(harness_for_bot(command.bot_id), runtime.clone());
    let open = service.execute(id, HarnessCommand::ConversationMessage(command.clone()));
    let (result, ()) = tokio::join!(open, complete_bound_handshake(&runtime));
    result.expect("a DM delivers its first prompt to the connected persona");
    assert_eq!(containers.spawned(), 0);
    assert_eq!(repo.get(id).await.unwrap().harness, "external");
    assert_eq!(prompts(&runtime.agent()).len(), 1);
    assert!(announcer.announced().is_empty());
    assert!(
        announcer.typed().iter().any(|typing| typing.active),
        "an external persona types like any other"
    );

    mention_origin_mut(&mut command).message_id = macro_uuid::generate_uuid_v7();
    assert_eq!(
        service
            .execute(id, HarnessCommand::ConversationMessage(command))
            .await
            .unwrap(),
        CommandOutcome::Queued
    );
    assert!(runtime.agent().received_notifications().is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_completed_conversation_message_never_runs_again_when_the_broker_replays_it(
    pool: sqlx::PgPool,
) {
    use crate::domain::conversation_turns::{ConversationTurnState, ConversationTurnStore};
    use agent_session::domain::agent_conversation::AgentConversationRepo;
    use channels::domain::agent_dm::AgentDmRepo;
    let journal =
        Arc::new(crate::outbound::conversation_turns::PgConversationTurnStore::new(pool.clone()));
    let ((service, _, containers, announcer, _), signals) = harness_with_ports_and_journal(
        PromptContextMock::default(),
        PromptComposerMock::default(),
        KindDefaultPolicies,
        HarnessDefaultCodingAgents,
        PromptMentionsMock::new(),
        Some(journal.clone()),
    );
    let mut command = direct_command();
    let channel = channels::outbound::pg_channels_repo::PgChannelsRepo::new(pool.clone())
        .ensure(mention_origin(&command).sender.clone(), command.bot_id)
        .await
        .unwrap()
        .dm
        .channel_id;
    let session = crate::testing::postgres_sessions(pool)
        .current_or_create(conversation(channel, &command))
        .await
        .unwrap();
    mention_origin_mut(&mut command).parent = MessageParent::Channel(channel);
    let source = mention_origin(&command).message_id;
    let container = open_direct(&service, &containers, session, command.clone()).await;
    says(&container.agent(), "Recorded answer");
    container.agent().completes_prompt().await;
    signals.lifecycle_published(4).await;
    let completed = journal.get(source, command.bot_id).await.unwrap().unwrap();
    assert_eq!(completed.state, ConversationTurnState::Succeeded);
    assert!(completed.reply_finalized);
    assert_eq!(answers(&announcer), ["Recorded answer"]);
    assert_eq!(
        service
            .execute(session, HarnessCommand::ConversationMessage(command))
            .await
            .unwrap(),
        CommandOutcome::Completed
    );
    service.recover_conversations().await.unwrap();
    assert_eq!(prompts(&container.agent()).len(), 1);
    assert!(announcer.announced().is_empty());
    assert_eq!(answers(&announcer), ["Recorded answer"]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn recovered_messages_dispatch_in_durable_order_even_when_delivered_in_reverse(
    pool: sqlx::PgPool,
) {
    use crate::domain::conversation_turns::ConversationTurnStore;
    use agent_session::domain::agent_conversation::AgentConversationRepo;
    use channels::domain::agent_dm::AgentDmRepo;
    let journal =
        Arc::new(crate::outbound::conversation_turns::PgConversationTurnStore::new(pool.clone()));
    let ((service, _, containers, announcer, _), signals) = harness_with_ports_and_journal(
        PromptContextMock::default(),
        PromptComposerMock::default(),
        KindDefaultPolicies,
        HarnessDefaultCodingAgents,
        PromptMentionsMock::new(),
        Some(journal.clone()),
    );
    let mut first = direct_command();
    let channel = channels::outbound::pg_channels_repo::PgChannelsRepo::new(pool.clone())
        .ensure(mention_origin(&first).sender.clone(), first.bot_id)
        .await
        .unwrap()
        .dm
        .channel_id;
    let session = crate::testing::postgres_sessions(pool)
        .current_or_create(conversation(channel, &first))
        .await
        .unwrap();
    mention_origin_mut(&mut first).parent = MessageParent::Channel(channel);
    mention_origin_mut(&mut first).content = "First admitted message".into();
    let mut second = first.clone();
    mention_origin_mut(&mut second).message_id = macro_uuid::generate_uuid_v7();
    mention_origin_mut(&mut second).content = "Second admitted message".into();
    journal
        .admit(session, channel, first.clone())
        .await
        .unwrap();
    journal
        .admit(session, channel, second.clone())
        .await
        .unwrap();

    let open = service.execute(session, HarnessCommand::ConversationMessage(second.clone()));
    let drive = async {
        while containers.spawned() == 0 {
            tokio::task::yield_now().await;
        }
        let container = containers.container(session_of(&containers)).unwrap();
        complete_session_handshake(&container).await;
        container
    };
    let (opened, container) = tokio::join!(open, drive);
    opened.unwrap();
    assert!(
        prompts(&container.agent()).is_empty(),
        "the later arrival waits for the older durable admission"
    );
    service
        .execute(session, HarnessCommand::ConversationMessage(first.clone()))
        .await
        .unwrap();
    container.agent().wait_for_requests(3).await;
    assert!(
        prompt_text(&container.agent(), 0).contains("First admitted message"),
        "the older admission runs first"
    );
    container.agent().completes_prompt().await;
    signals.lifecycle_published(4).await;
    container.agent().wait_for_requests(4).await;
    assert!(prompt_text(&container.agent(), 1).contains("Second admitted message"));
    assert!(announcer.announced().is_empty());
    assert_eq!(containers.spawned(), 1);
}

/// The text of the `index`-th prompt the agent received.
fn prompt_text(agent: &FakeAgent, index: usize) -> String {
    serde_json::to_string(&prompts(agent)[index]).unwrap()
}

/// A direct conversation over `journal`, with its first message delivered
/// to a running agent.
async fn journaled_conversation(
    pool: sqlx::PgPool,
    journal: Arc<dyn crate::domain::conversation_turns::ConversationTurnStore>,
) -> (
    TestHarness,
    AnnouncerMock,
    TurnSignals,
    ContainerMock,
    OpenSession,
) {
    use agent_session::domain::agent_conversation::AgentConversationRepo;
    use channels::domain::agent_dm::AgentDmRepo;
    let ((service, _, containers, announcer, _), signals) = harness_with_ports_and_journal(
        PromptContextMock::default(),
        PromptComposerMock::default(),
        KindDefaultPolicies,
        HarnessDefaultCodingAgents,
        PromptMentionsMock::new(),
        Some(journal),
    );
    let mut command = direct_command();
    let channel = channels::outbound::pg_channels_repo::PgChannelsRepo::new(pool.clone())
        .ensure(mention_origin(&command).sender.clone(), command.bot_id)
        .await
        .unwrap()
        .dm
        .channel_id;
    let session = crate::testing::postgres_sessions(pool)
        .current_or_create(conversation(channel, &command))
        .await
        .unwrap();
    mention_origin_mut(&mut command).parent = MessageParent::Channel(channel);
    let container = open_direct(&service, &containers, session, command.clone()).await;
    (service, announcer, signals, container, command)
}

fn pg_journal(
    pool: &sqlx::PgPool,
) -> Arc<crate::outbound::conversation_turns::PgConversationTurnStore> {
    Arc::new(crate::outbound::conversation_turns::PgConversationTurnStore::new(pool.clone()))
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_answer_that_could_not_be_posted_is_posted_by_recovery(pool: sqlx::PgPool) {
    use crate::domain::conversation_turns::ConversationTurnStore;
    let journal = pg_journal(&pool);
    let (service, announcer, signals, container, command) =
        journaled_conversation(pool, journal.clone()).await;
    let source = mention_origin(&command).message_id;
    says(&container.agent(), "The only passage.");
    announcer.fails("messages unavailable");
    container.agent().completes_prompt().await;
    signals.lifecycle_published(4).await;
    let unposted = journal.get(source, command.bot_id).await.unwrap().unwrap();
    assert!(!unposted.reply_finalized);
    assert!(answers(&announcer).is_empty());

    // The replica that watched the turn has forgotten its reply by now.
    announcer.recovers();
    service.recover_conversations().await.unwrap();
    assert_eq!(answers(&announcer), ["The only passage."]);
    let reserved = unposted.in_flight.unwrap().presented;
    assert!(
        announcer
            .presented()
            .iter()
            .all(|reply| reserved.contains(&reply.message_id)),
        "the answer is posted under the id its turn reserved"
    );
    assert!(
        journal
            .get(source, command.bot_id)
            .await
            .unwrap()
            .unwrap()
            .reply_finalized
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_answer_whose_turn_ended_unwatched_is_still_posted(pool: sqlx::PgPool) {
    use crate::domain::conversation_turns::{ConversationTurnState, ConversationTurnStore};
    let journal = pg_journal(&pool);
    let (service, announcer, _signals, container, command) =
        journaled_conversation(pool, journal.clone()).await;
    let source = mention_origin(&command).message_id;
    let session = journal
        .get(source, command.bot_id)
        .await
        .unwrap()
        .unwrap()
        .session_id;
    says(&container.agent(), "Answered after a restart.");
    eventually("the reply reserves its message", || {
        service
            .inner
            .busy
            .turn(session)
            .is_some_and(|turn| !turn.presented.is_empty())
    })
    .await;
    // As after a restart: nothing in memory says which turn runs here.
    service.inner.busy.take(session);
    service.inner.projections.clear();
    container.agent().completes_prompt().await;
    let finished = tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            let record = journal.get(source, command.bot_id).await.unwrap().unwrap();
            if record.reply_finalized {
                break record;
            }
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
    })
    .await
    .expect("the turn's end reconciles its reply");
    assert_eq!(finished.state, ConversationTurnState::Succeeded);
    let presented = announcer.presented();
    assert!(
        matches!(
            presented.as_slice(),
            [reply] if reply.notify
                && reply.outcome
                    == Some(ReplyOutcome::Answered("Answered after a restart.".to_owned()))
        ),
        "the answer is posted, as news, though nobody saw its passages: {presented:#?}"
    );
}

/// A journal whose writes of a turn's end fail while `fail_finish` is set.
struct FlakyJournal {
    inner: crate::outbound::conversation_turns::PgConversationTurnStore,
    fail_finish: std::sync::atomic::AtomicBool,
}

#[async_trait::async_trait]
impl crate::domain::conversation_turns::ConversationTurnStore for FlakyJournal {
    async fn claim_delivery(
        &self,
        session: AgentSessionId,
    ) -> agent_session::domain::error::Result<
        Option<Box<dyn crate::domain::conversation_turns::ConversationLease>>,
    > {
        self.inner.claim_delivery(session).await
    }
    async fn claim_context(
        &self,
        session: AgentSessionId,
    ) -> agent_session::domain::error::Result<
        Option<Box<dyn crate::domain::conversation_turns::ConversationLease>>,
    > {
        self.inner.claim_context(session).await
    }
    async fn cancel_queued(
        &self,
        session: AgentSessionId,
    ) -> agent_session::domain::error::Result<()> {
        self.inner.cancel_queued(session).await
    }
    async fn settings(
        &self,
        session: AgentSessionId,
    ) -> agent_session::domain::error::Result<
        Option<crate::domain::conversation_turns::ConversationSettings>,
    > {
        self.inner.settings(session).await
    }
    async fn pin_settings(
        &self,
        session: AgentSessionId,
        settings: crate::domain::conversation_turns::ConversationSettings,
    ) -> agent_session::domain::error::Result<crate::domain::conversation_turns::ConversationSettings>
    {
        self.inner.pin_settings(session, settings).await
    }
    async fn admit(
        &self,
        session: AgentSessionId,
        channel: macro_uuid::Uuid,
        command: OpenSession,
    ) -> agent_session::domain::error::Result<crate::domain::conversation_turns::ConversationTurn>
    {
        self.inner.admit(session, channel, command).await
    }
    async fn get(
        &self,
        source: macro_uuid::Uuid,
        bot: BotId,
    ) -> agent_session::domain::error::Result<
        Option<crate::domain::conversation_turns::ConversationTurn>,
    > {
        self.inner.get(source, bot).await
    }
    async fn by_action(
        &self,
        action: AgentActionId,
    ) -> agent_session::domain::error::Result<
        Option<crate::domain::conversation_turns::ConversationTurn>,
    > {
        self.inner.by_action(action).await
    }
    async fn retry(
        &self,
        source: macro_uuid::Uuid,
        bot: BotId,
        expected: AgentActionId,
    ) -> agent_session::domain::error::Result<bool> {
        self.inner.retry(source, bot, expected).await
    }
    async fn claim(
        &self,
        action: AgentActionId,
        turn: &crate::domain::queue::InFlightTurn,
    ) -> agent_session::domain::error::Result<bool> {
        self.inner.claim(action, turn).await
    }
    async fn record_flight(
        &self,
        action: AgentActionId,
        turn: &crate::domain::queue::InFlightTurn,
    ) -> agent_session::domain::error::Result<()> {
        self.inner.record_flight(action, turn).await
    }
    async fn save_reply(
        &self,
        action: AgentActionId,
        segments: &[agent_fold::domain::model::ProjectedSegment],
    ) -> agent_session::domain::error::Result<()> {
        self.inner.save_reply(action, segments).await
    }
    async fn finish(
        &self,
        action: AgentActionId,
        state: crate::domain::conversation_turns::ConversationTurnState,
        outcome: ReplyOutcome,
    ) -> agent_session::domain::error::Result<()> {
        if self.fail_finish.load(std::sync::atomic::Ordering::SeqCst) {
            return Err(anyhow::anyhow!("the journal is unreachable").into());
        }
        self.inner.finish(action, state, outcome).await
    }
    async fn fail_queued(&self, action: AgentActionId) -> agent_session::domain::error::Result<()> {
        self.inner.fail_queued(action).await
    }
    async fn finalize_reply(
        &self,
        action: AgentActionId,
        outcome: &ReplyOutcome,
    ) -> agent_session::domain::error::Result<()> {
        self.inner.finalize_reply(action, outcome).await
    }
    async fn claim_reply(
        &self,
        action: AgentActionId,
    ) -> agent_session::domain::error::Result<
        Option<Box<dyn crate::domain::conversation_turns::ConversationLease>>,
    > {
        self.inner.claim_reply(action).await
    }
    async fn pending(
        &self,
        limit: u16,
    ) -> agent_session::domain::error::Result<
        Vec<crate::domain::conversation_turns::ConversationTurn>,
    > {
        self.inner.pending(limit).await
    }
    async fn running(
        &self,
        limit: u16,
    ) -> agent_session::domain::error::Result<
        Vec<crate::domain::conversation_turns::ConversationTurn>,
    > {
        self.inner.running(limit).await
    }
    async fn for_conversation(
        &self,
        channel: macro_uuid::Uuid,
        bot: BotId,
    ) -> agent_session::domain::error::Result<
        Vec<crate::domain::conversation_turns::ConversationTurnStatus>,
    > {
        self.inner.for_conversation(channel, bot).await
    }
    async fn pending_replies(
        &self,
        limit: u16,
    ) -> agent_session::domain::error::Result<
        Vec<crate::domain::conversation_turns::ConversationTurn>,
    > {
        self.inner.pending_replies(limit).await
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_turn_end_the_journal_cannot_record_still_frees_the_session(pool: sqlx::PgPool) {
    let journal = Arc::new(FlakyJournal {
        inner: crate::outbound::conversation_turns::PgConversationTurnStore::new(pool.clone()),
        fail_finish: std::sync::atomic::AtomicBool::new(false),
    });
    let (service, announcer, _signals, container, _) =
        journaled_conversation(pool, journal.clone()).await;
    let agent = container.agent();
    let session = service.inner.busy.running()[0].0;
    journal
        .fail_finish
        .store(true, std::sync::atomic::Ordering::SeqCst);
    says(&agent, "First answer.");
    agent.completes_prompt().await;
    eventually("the session is free for its next command", || {
        service.inner.busy.turn(session).is_none() && !service.inner.busy.is_pending(session)
    })
    .await;
    assert_eq!(
        answers(&announcer),
        ["First answer."],
        "the reply still shows how the turn ended"
    );
}
