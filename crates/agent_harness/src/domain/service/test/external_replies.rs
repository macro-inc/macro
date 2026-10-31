use super::*;
use crate::domain::external_replies::*;
use crate::domain::model::{AnnouncePrompt, ReplyOutcome};
use agent_fold::domain::model::{StopReason, TurnId};
use std::collections::HashMap;

type Key = (AgentSessionId, AgentActionId);
#[derive(Default)]
struct ReplyStore {
    rows: Mutex<HashMap<Key, ExternalReply>>,
    lock: Arc<tokio::sync::Mutex<()>>,
    fail_reserve: std::sync::atomic::AtomicBool,
}
impl ExternalReplyLease for tokio::sync::OwnedMutexGuard<()> {}
#[async_trait::async_trait]
impl ExternalReplyStore for ReplyStore {
    async fn reserve(
        &self,
        session: AgentSessionId,
        action: AgentActionId,
        target: &ExternalReplyTarget,
    ) -> agent_session::domain::error::Result<()> {
        if self
            .fail_reserve
            .swap(false, std::sync::atomic::Ordering::SeqCst)
        {
            return Err(rootcause::report!("reservation temporarily unavailable").into());
        }
        self.rows
            .lock()
            .unwrap()
            .entry((session, action))
            .or_insert(ExternalReply {
                session_id: session,
                action_id: action,
                target: None,
                completion: None,
                created_at: chrono::Utc::now(),
                announced: false,
                finalized: false,
            })
            .target
            .get_or_insert(target.clone());
        Ok(())
    }
    async fn complete(
        &self,
        session: AgentSessionId,
        action: AgentActionId,
        completion: &ExternalReplyCompletion,
    ) -> agent_session::domain::error::Result<()> {
        let mut rows = self.rows.lock().unwrap();
        let row = rows.entry((session, action)).or_insert(ExternalReply {
            session_id: session,
            action_id: action,
            target: None,
            completion: None,
            created_at: chrono::Utc::now(),
            announced: false,
            finalized: false,
        });
        if row.completion.is_none() {
            row.completion = Some(completion.clone());
        }
        Ok(())
    }
    async fn get(
        &self,
        session: AgentSessionId,
        action: AgentActionId,
    ) -> agent_session::domain::error::Result<Option<ExternalReply>> {
        Ok(self.rows.lock().unwrap().get(&(session, action)).cloned())
    }
    async fn claim(
        &self,
        _: AgentSessionId,
        _: AgentActionId,
    ) -> agent_session::domain::error::Result<Option<Box<dyn ExternalReplyLease>>> {
        Ok(self
            .lock
            .clone()
            .try_lock_owned()
            .ok()
            .map(|lease| Box::new(lease) as Box<dyn ExternalReplyLease>))
    }
    async fn mark_announced(
        &self,
        session: AgentSessionId,
        action: AgentActionId,
    ) -> agent_session::domain::error::Result<()> {
        self.rows
            .lock()
            .unwrap()
            .get_mut(&(session, action))
            .unwrap()
            .announced = true;
        Ok(())
    }
    async fn finalize(
        &self,
        session: AgentSessionId,
        action: AgentActionId,
    ) -> agent_session::domain::error::Result<()> {
        self.rows
            .lock()
            .unwrap()
            .get_mut(&(session, action))
            .unwrap()
            .finalized = true;
        Ok(())
    }
    async fn pending(
        &self,
        limit: u16,
    ) -> agent_session::domain::error::Result<Vec<ExternalReply>> {
        Ok(self
            .rows
            .lock()
            .unwrap()
            .values()
            .filter(|row| row.target.is_some() && !row.finalized)
            .take(limit.into())
            .cloned()
            .collect())
    }
}

#[tokio::test]
async fn an_external_mention_resolves_and_a_followup_can_finish_before_its_announcement() {
    let store = Arc::new(ReplyStore::default());
    let mut service =
        harness_sharing_repo(InMemoryAgentSessionRepo::new()).with_external_replies(store.clone());
    Arc::get_mut(&mut service.inner).unwrap().coding_agents = Box::new(ChosenCodingAgents(false));
    let source = macro_uuid::generate_uuid_v7();
    let mut request = open_external_request("/workspace");
    request.thread = Some(agent_session::domain::ports::SessionThread {
        reuse_origin_message: false,
        parent: MessageParent::Channel(Uuid::from_u128(100)),
        thread_id: source,
        message_id: source,
        content: "hello @ehayes".into(),
    });
    let session = service.open_external_session(request).await.unwrap();
    let announced = service.inner.announcer.announced_messages();
    assert_eq!(announced.len(), 1);
    service
        .execute_here(
            session.id,
            HarnessCommand::Turn(TurnSignal::TurnEnded {
                notification_noop: false,
                turn: TurnId(0),
                action_id: Some(AgentActionId::from_uuid(source)),
                stop: StopReason::EndTurn,
                last_text: Some("I am Eric Hayes.".into()),
            }),
        )
        .await
        .unwrap();
    let replies = service.inner.announcer.resolved();
    assert_eq!(replies.len(), 1);
    assert_eq!(replies[0].message_id, announced[0].message_id);
    assert_eq!(
        replies[0].outcome,
        ReplyOutcome::Answered("I am Eric Hayes.".into())
    );

    let followup = macro_uuid::generate_uuid_v7();
    service
        .execute_here(
            session.id,
            HarnessCommand::Turn(TurnSignal::TurnEnded {
                notification_noop: false,
                turn: TurnId(1),
                action_id: Some(AgentActionId::from_uuid(followup)),
                stop: StopReason::EndTurn,
                last_text: Some("I am Eric Hayes, again.".into()),
            }),
        )
        .await
        .unwrap();
    assert_eq!(service.inner.announcer.resolved().len(), 1);
    let prompt = AnnouncePrompt {
        bot_id: session.bot_id,
        origin: AnnounceOrigin {
            reuse_origin_message: false,
            reply_placement: Default::default(),
            parent: MessageParent::Channel(Uuid::from_u128(100)),
            thread_id: source,
            message_id: followup,
        },
        content: "again".into(),
        sender: sender(),
    };
    service
        .announce_external_prompt(session.id, prompt.clone())
        .await
        .unwrap();
    service
        .announce_external_prompt(session.id, prompt)
        .await
        .unwrap();
    assert_eq!(service.inner.announcer.announced_messages().len(), 2);
    let replies = service.inner.announcer.resolved();
    assert_eq!(replies.len(), 2);
    assert_ne!(replies[0].message_id, replies[1].message_id);
    assert_eq!(
        replies[1].outcome,
        ReplyOutcome::Answered("I am Eric Hayes, again.".into())
    );
    assert!(store.pending(100).await.unwrap().is_empty());
}

#[tokio::test]
async fn failed_channel_updates_retry_after_restart_without_reprompting() {
    let repo = InMemoryAgentSessionRepo::new();
    let store = Arc::new(ReplyStore::default());
    let mut service = harness_sharing_repo(repo.clone()).with_external_replies(store.clone());
    Arc::get_mut(&mut service.inner).unwrap().coding_agents = Box::new(ChosenCodingAgents(false));
    let session = service
        .open_external_session(open_external_request("/workspace"))
        .await
        .unwrap();
    let source = macro_uuid::generate_uuid_v7();
    service
        .announce_external_prompt(
            session.id,
            AnnouncePrompt {
                bot_id: session.bot_id,
                origin: AnnounceOrigin {
                    reuse_origin_message: false,
                    reply_placement: Default::default(),
                    parent: MessageParent::Channel(Uuid::from_u128(100)),
                    thread_id: source,
                    message_id: source,
                },
                content: "hello".into(),
                sender: sender(),
            },
        )
        .await
        .unwrap();
    let original = service.inner.announcer.announced_messages()[0].message_id;
    service.inner.announcer.fails("message service unavailable");
    service
        .execute_here(
            session.id,
            HarnessCommand::Turn(TurnSignal::TurnEnded {
                notification_noop: false,
                turn: TurnId(0),
                action_id: Some(AgentActionId::from_uuid(source)),
                stop: StopReason::Cancelled,
                last_text: None,
            }),
        )
        .await
        .unwrap();
    assert_eq!(store.pending(100).await.unwrap().len(), 1);
    let restarted = harness_sharing_repo(repo).with_external_replies(store.clone());
    restarted.recover_external_replies().await.unwrap();
    let replies = restarted.inner.announcer.resolved();
    assert_eq!(replies.len(), 1);
    assert_eq!(replies[0].message_id, original);
    assert_eq!(replies[0].outcome, ReplyOutcome::Cancelled);
    let duplicate = restarted
        .execute_here(
            session.id,
            HarnessCommand::Deliver(DeliverAction::control(ControlEvent {
                action_id: Some(AgentActionId::from_uuid(source)),
                action: AgentAction::prompt("retry"),
                actor: Some(sender()),
                context: None,
            })),
        )
        .await
        .unwrap();
    assert!(matches!(duplicate, CommandOutcome::Completed));
    assert!(restarted.inner.queues.list(session.id).is_empty());
    assert!(store.pending(100).await.unwrap().is_empty());
}

#[tokio::test]
async fn recovery_rebuilds_a_missed_completion_from_the_durable_protocol_log() {
    let repo = InMemoryAgentSessionRepo::new();
    let store = Arc::new(ReplyStore::default());
    let mut service = harness_sharing_repo(repo.clone()).with_external_replies(store.clone());
    Arc::get_mut(&mut service.inner).unwrap().coding_agents = Box::new(ChosenCodingAgents(false));
    let session = service
        .open_external_session(open_external_request("/workspace"))
        .await
        .unwrap();
    let source = macro_uuid::generate_uuid_v7();
    service
        .announce_external_prompt(
            session.id,
            AnnouncePrompt {
                bot_id: session.bot_id,
                origin: AnnounceOrigin {
                    reuse_origin_message: false,
                    reply_placement: Default::default(),
                    parent: MessageParent::Channel(Uuid::from_u128(100)),
                    thread_id: source,
                    message_id: source,
                },
                content: "hello".into(),
                sender: sender(),
            },
        )
        .await
        .unwrap();
    let original = service.inner.announcer.announced_messages()[0].message_id;
    // The actor committed the answer, but the process died before TurnEnded
    // reached the harness. A new harness has only the log and reply journal.
    repo.extend_log(agent_fold::testing::parse_log_as(
        session.id,
        &agent_fold::testing::TURN.replace("prompt-1", &source.to_string()),
    ));
    store
        .rows
        .lock()
        .unwrap()
        .get_mut(&(session.id, AgentActionId::from_uuid(source)))
        .unwrap()
        .created_at -= chrono::TimeDelta::hours(25);
    let restarted = harness_sharing_repo(repo).with_external_replies(store.clone());
    // A retry can beat the periodic recovery worker; the durable prompt alone
    // must prevent re-executing it.
    let duplicate = restarted
        .execute_here(
            session.id,
            HarnessCommand::Deliver(DeliverAction::control(ControlEvent {
                action_id: Some(AgentActionId::from_uuid(source)),
                action: AgentAction::prompt("retry"),
                actor: Some(sender()),
                context: None,
            })),
        )
        .await
        .unwrap();
    assert!(matches!(duplicate, CommandOutcome::Completed));
    assert!(restarted.inner.queues.list(session.id).is_empty());
    restarted.recover_external_replies().await.unwrap();
    let replies = restarted.inner.announcer.resolved();
    assert_eq!(replies.len(), 1);
    assert_eq!(replies[0].message_id, original);
    assert_eq!(replies[0].outcome, ReplyOutcome::Answered("Done.".into()));
    assert!(store.pending(100).await.unwrap().is_empty());
}

#[tokio::test]
async fn successful_announcements_are_not_repeated_after_restart() {
    let repo = InMemoryAgentSessionRepo::new();
    let store = Arc::new(ReplyStore::default());
    let mut service = harness_sharing_repo(repo.clone()).with_external_replies(store.clone());
    Arc::get_mut(&mut service.inner).unwrap().coding_agents = Box::new(ChosenCodingAgents(false));
    let session = service
        .open_external_session(open_external_request("/workspace"))
        .await
        .unwrap();
    let source = macro_uuid::generate_uuid_v7();
    let action = AgentActionId::from_uuid(source);
    service
        .announce_external_prompt(
            session.id,
            AnnouncePrompt {
                bot_id: session.bot_id,
                origin: AnnounceOrigin {
                    reuse_origin_message: false,
                    reply_placement: Default::default(),
                    parent: MessageParent::Channel(Uuid::from_u128(100)),
                    thread_id: source,
                    message_id: source,
                },
                content: "hello".into(),
                sender: sender(),
            },
        )
        .await
        .unwrap();
    let original = service.inner.announcer.announced_messages()[0].message_id;
    let restarted = harness_sharing_repo(repo).with_external_replies(store.clone());
    restarted.recover_external_replies().await.unwrap();
    assert!(restarted.inner.announcer.announced().is_empty());
    assert!(restarted.inner.announcer.resolved().is_empty());
    store
        .rows
        .lock()
        .unwrap()
        .get_mut(&(session.id, action))
        .unwrap()
        .created_at -= chrono::TimeDelta::hours(25);
    restarted.recover_external_replies().await.unwrap();
    assert_eq!(store.pending(100).await.unwrap().len(), 1);
    assert!(
        store
            .get(session.id, action)
            .await
            .unwrap()
            .unwrap()
            .completion
            .is_none()
    );
    assert!(restarted.inner.announcer.resolved().is_empty());
    restarted
        .inner
        .complete_external_reply(
            session.id,
            action,
            TurnId(0),
            ReplyOutcome::Answered("Late answer".into()),
        )
        .await;
    let replies = restarted.inner.announcer.resolved();
    assert_eq!(replies.len(), 1);
    assert_eq!(replies[0].message_id, original);
    assert_eq!(
        replies[0].outcome,
        ReplyOutcome::Answered("Late answer".into())
    );
    assert!(restarted.inner.announcer.announced().is_empty());
    assert!(store.pending(100).await.unwrap().is_empty());
}

#[tokio::test]
async fn an_unauthorized_destination_never_reserves_or_posts_a_reply() {
    let store = Arc::new(ReplyStore::default());
    let mut service =
        harness_sharing_repo(InMemoryAgentSessionRepo::new()).with_external_replies(store.clone());
    let inner = Arc::get_mut(&mut service.inner).unwrap();
    inner.coding_agents = Box::new(ChosenCodingAgents(false));
    inner.prompt_context = PromptContextMock::unauthorized("access revoked");
    let session = service
        .open_external_session(open_external_request("/workspace"))
        .await
        .unwrap();
    let source = macro_uuid::generate_uuid_v7();
    let result = service
        .announce_external_prompt(
            session.id,
            AnnouncePrompt {
                bot_id: session.bot_id,
                origin: AnnounceOrigin {
                    reuse_origin_message: false,
                    reply_placement: Default::default(),
                    parent: MessageParent::Channel(Uuid::from_u128(100)),
                    thread_id: source,
                    message_id: source,
                },
                content: "hello".into(),
                sender: sender(),
            },
        )
        .await;
    assert!(matches!(result, Err(HarnessError::PromptContext(_))));
    assert!(store.rows.lock().unwrap().is_empty());
    assert!(service.inner.announcer.announced().is_empty());
}

#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn creation_retries_repair_reservation_for_both_primary_key_and_thread_conflicts(
    pool: sqlx::PgPool,
) {
    let macro_user = macro_uuid::generate_uuid_v7();
    sqlx::query!("INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, 'asker@example.com', 'asker@example.com', 'external-reply-test')", macro_user).execute(&pool).await.unwrap();
    sqlx::query!(r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ('macro|asker@example.com', 'asker@example.com', $1)"#, macro_user).execute(&pool).await.unwrap();
    use bots::domain::models::{BotOwner, CreateBotRequest};
    use bots::domain::ports::BotRepo;
    let bot = bots::outbound::pg_bots_repo::PgBotsRepo::new(pool.clone())
        .create_owned_bot(
            BotOwner::User {
                user_id: sender().to_string(),
            },
            sender(),
            CreateBotRequest {
                team_id: None,
                name: "External chat agent".into(),
                handle: format!("external-{}", macro_uuid::generate_uuid_v7()),
                description: None,
                avatar_url: None,
                has_agent: None,
            },
        )
        .await
        .unwrap()
        .id;
    let repo = crate::testing::postgres_sessions(pool.clone());
    let store = Arc::new(ReplyStore::default());
    let runtimes = RuntimeRegistry::new();
    let service = AgentHarnessService::new(
        None,
        AgentSessionServiceImpl::new(
            repo.clone(),
            FoldedMessageService::new(repo.clone()),
            NoOpRealtime,
            NoOpAgentSessionNameGenerator,
            Arc::new(NoOpTurnObserver),
            Arc::new(RecordingLifecyclePublisher::new()),
            ReplicaId::mint(),
        ),
        MockContainerManager::new(),
        AnnouncerMock::new(),
        TestConnections::new(MirrorBindings, Arc::clone(&runtimes)),
        PromptContextMock::default(),
        PromptComposerMock::default(),
        EgressProvisionerMock::new(),
        NoPeers,
        KindDefaultPolicies,
        ChosenCodingAgents(false),
        HarnessDefaults::new(SessionDefaults {
            bot_id: BotId::TEST_A,
            model: "fixed".into(),
            harness: "macrod".into(),
            repo_url: None,
        }),
        RecordingLifecyclePublisher::new(),
        crate::domain::pending::PendingCommands::new(),
        PromptMentionsMock::new(),
        NotifierMock::new(),
    )
    .with_external_replies(store.clone());
    let id = AgentSessionId::new();
    let source = macro_uuid::generate_uuid_v7();
    use channels::domain::agent_dm::AgentDmRepo;
    let channel = channels::outbound::pg_channels_repo::PgChannelsRepo::new(pool.clone())
        .ensure(sender(), bot)
        .await
        .unwrap()
        .dm
        .channel_id;
    sqlx::query!("INSERT INTO comms_messages (id, sender_id, content, parent_entity_type, parent_entity_id) VALUES ($1, 'macro|asker@example.com', 'hello', 'channel', $2)", source, channel.to_string()).execute(&pool).await.unwrap();
    let mut request = open_external_request("/workspace");
    request.id = Some(id);
    request.bot_id = bot;
    request.thread = Some(agent_session::domain::ports::SessionThread {
        reuse_origin_message: false,
        parent: MessageParent::Channel(channel),
        thread_id: source,
        message_id: source,
        content: "hello".into(),
    });
    store
        .fail_reserve
        .store(true, std::sync::atomic::Ordering::SeqCst);
    assert!(
        service
            .open_external_session(request.clone())
            .await
            .is_err()
    );
    assert_eq!(repo.get(id).await.unwrap().id, id);
    assert!(store.rows.lock().unwrap().is_empty());
    assert!(matches!(
        service.open_external_session(request.clone()).await,
        Err(AgentSessionError::ThreadSessionExists)
    ));
    let action = AgentActionId::from_uuid(source);
    let reply_id = store
        .get(id, action)
        .await
        .unwrap()
        .unwrap()
        .target
        .unwrap()
        .message_id;
    request.id = Some(AgentSessionId::new());
    assert!(matches!(
        service.open_external_session(request.clone()).await,
        Err(AgentSessionError::ThreadSessionExists)
    ));
    assert_eq!(
        store
            .get(id, action)
            .await
            .unwrap()
            .unwrap()
            .target
            .unwrap()
            .message_id,
        reply_id
    );
    assert_eq!(service.inner.announcer.announced_messages().len(), 1);
    // The runtime commits its answer and later reconnects with session/load,
    // but the observer callback never reached this harness.
    for entry in agent_fold::testing::parse_log_as(
        id,
        &agent_fold::testing::TURN.replace("prompt-1", &source.to_string()),
    ) {
        agent_session::domain::ports::AgentSessionLogRepo::create(&repo, entry)
            .await
            .unwrap();
    }
    service.inner.sessions.mark_disconnected(id).await.unwrap();
    let reloaded = include_str!("external_replies/load.jsonl");
    let mut boundary = None;
    for entry in agent_fold::testing::parse_log_as(id, reloaded) {
        let stored = agent_session::domain::ports::AgentSessionLogRepo::create(&repo, entry)
            .await
            .unwrap();
        boundary.get_or_insert(stored.id);
    }
    sqlx::query!(
        "UPDATE agent_session SET history_start_log_id = $2 WHERE id = $1",
        id.as_uuid(),
        boundary
    )
    .execute(&pool)
    .await
    .unwrap();
    let visible = service.inner.sessions.folded_session_log(id).await.unwrap();
    assert!(!visible.messages.is_empty());
    assert!(
        visible
            .messages
            .iter()
            .all(|message| message.request_id != Some(action))
    );
    let duplicate = service
        .execute_here(
            id,
            HarnessCommand::Deliver(DeliverAction::control(ControlEvent {
                action_id: Some(action),
                action: AgentAction::prompt("retry"),
                actor: Some(sender()),
                context: None,
            })),
        )
        .await
        .unwrap();
    assert!(matches!(duplicate, CommandOutcome::Completed));
    service.recover_external_replies().await.unwrap();
    let replies = service.inner.announcer.resolved();
    assert_eq!(replies.len(), 1);
    assert_eq!(replies[0].message_id, reply_id);
    assert_eq!(replies[0].outcome, ReplyOutcome::Answered("Done.".into()));
    assert!(store.pending(100).await.unwrap().is_empty());

    request.bot_id = BotId::TEST_A;
    request.id = Some(id);
    assert!(
        matches!(service.open_external_session(request).await, Err(AgentSessionError::SessionIdTaken(taken)) if taken == id)
    );
}

#[tokio::test]
async fn recovery_finishes_a_turn_interrupted_before_an_acp_response() {
    let repo = InMemoryAgentSessionRepo::new();
    let store = Arc::new(ReplyStore::default());
    let mut service = harness_sharing_repo(repo.clone()).with_external_replies(store.clone());
    Arc::get_mut(&mut service.inner).unwrap().coding_agents = Box::new(ChosenCodingAgents(false));
    let session = service
        .open_external_session(open_external_request("/workspace"))
        .await
        .unwrap();
    let source = macro_uuid::generate_uuid_v7();
    service
        .announce_external_prompt(
            session.id,
            AnnouncePrompt {
                bot_id: session.bot_id,
                origin: AnnounceOrigin {
                    reuse_origin_message: false,
                    reply_placement: Default::default(),
                    parent: MessageParent::Channel(Uuid::from_u128(100)),
                    thread_id: source,
                    message_id: source,
                },
                content: "hello".into(),
                sender: sender(),
            },
        )
        .await
        .unwrap();
    let interrupted = agent_fold::testing::TURN
        .lines()
        .take(6)
        .collect::<Vec<_>>()
        .join("\n")
        .replace("prompt-1", &source.to_string());
    repo.extend_log(agent_fold::testing::parse_log_as(session.id, &interrupted));
    store
        .rows
        .lock()
        .unwrap()
        .get_mut(&(session.id, AgentActionId::from_uuid(source)))
        .unwrap()
        .created_at -= chrono::TimeDelta::hours(25);
    service.recover_external_replies().await.unwrap();
    assert!(service.inner.announcer.resolved().is_empty());
    assert_eq!(store.pending(100).await.unwrap().len(), 1);
    service
        .inner
        .sessions
        .mark_disconnected(session.id)
        .await
        .unwrap();
    let restarted = harness_sharing_repo(repo).with_external_replies(store.clone());
    restarted.recover_external_replies().await.unwrap();
    let replies = restarted.inner.announcer.resolved();
    assert_eq!(replies.len(), 1);
    assert_eq!(replies[0].outcome, ReplyOutcome::Failed);
    assert!(store.pending(100).await.unwrap().is_empty());
}
