use super::*;
use crate::PROTOCOL_VERSION;
use crate::domain::model::{DEFAULT_AGENT_SESSION_NAME, Message, SessionBot};
use crate::domain::ports::NoOpRealtime;
use crate::domain::session::HandshakeStatus;
use crate::testing::{InMemoryAgentSessionRepo, RecordingRealtime, test_agent_session};
use agent_fold::domain::fold::fold;
use agent_fold::domain::service::FoldedMessageService;
use agent_fold::testing::{TURN, parse_log_as, test_session};
use agent_runtime_protocol::domain::ports::{
    Transport, TransportError, TransportReceiver, TransportSender,
};
use agent_runtime_protocol::domain::schema::v0::ToRuntimeMessage;
use agent_runtime_protocol::domain::schema::v0::{AcpMessage, ToServerMessage};
use entity_access::domain::models::{EntityAccessReceipt, EntityType, OwnerAccessLevel};
use macro_uuid::Uuid;
use std::sync::{Arc, Mutex};
use tokio::sync::Notify;
use tracing::instrument::WithSubscriber as _;

struct Fixture {
    service: AgentSessionServiceImpl<
        InMemoryAgentSessionRepo,
        FoldedMessageService<InMemoryAgentSessionRepo>,
        NoOpRealtime,
    >,
    repo: InMemoryAgentSessionRepo,
    session: AgentSessionId,
}

fn fixture() -> Fixture {
    let repo = InMemoryAgentSessionRepo::new();
    let session = AgentSessionId::new_from_uuid(Uuid::from_u128(1));
    repo.insert_session(test_agent_session(session));

    Fixture {
        // Nothing here is about streaming, so there are no viewers to publish
        // to.
        service: AgentSessionServiceImpl::new(
            repo.clone(),
            FoldedMessageService::new(repo.clone()),
            NoOpRealtime,
        ),
        repo,
        session,
    }
}

#[tokio::test]
async fn only_the_first_prompt_is_selected_for_automatic_naming() {
    let repo = InMemoryAgentSessionRepo::new();
    let session = test_session();
    repo.insert_session(test_agent_session(session));
    let folds = FoldedMessageService::new(repo.clone());
    let mut prompt = AgentAction::prompt("composed prompt with private context");
    let AgentAction::Prompt(prompt_action) = &mut prompt else {
        unreachable!("the test constructed a prompt");
    };
    prompt_action.set_name_source("fix the flaky tests");

    assert_eq!(
        initial_prompt_for_rename(&folds, session, &prompt).await,
        Some("fix the flaky tests".to_owned())
    );

    repo.extend_log(parse_log_as(session, TURN));
    assert_eq!(
        initial_prompt_for_rename(&folds, session, &prompt).await,
        None
    );
}

#[derive(Clone, Copy)]
struct FixedNameGenerator;

impl AgentSessionNameGenerator for FixedNameGenerator {
    async fn generate_name(
        &self,
        _session: &AgentSession,
        initial_prompt: &str,
    ) -> std::result::Result<Option<String>, rootcause::Report> {
        assert_eq!(initial_prompt, "fix the flaky tests");
        Ok(Some("Fix Flaky Tests".to_owned()))
    }
}

#[derive(Clone, Default)]
struct RenameRealtime(Arc<Mutex<Vec<AgentSessionRenamed>>>);

impl AgentSessionRealtime for RenameRealtime {
    async fn publish(&self, _event: LogAppended) -> std::result::Result<(), rootcause::Report> {
        Ok(())
    }

    async fn publish_renamed(
        &self,
        event: AgentSessionRenamed,
    ) -> std::result::Result<(), rootcause::Report> {
        self.0
            .lock()
            .expect("rename store is not poisoned")
            .push(event);
        Ok(())
    }
}

struct PendingTransport;

#[derive(Clone)]
struct PendingSender;

struct PendingReceiver;

struct RecordingTransport {
    outbound: mpsc::Sender<ToRuntimeMessage>,
    inbound: mpsc::Receiver<ToServerMessage>,
}

#[derive(Clone)]
struct RecordingSender(mpsc::Sender<ToRuntimeMessage>);

impl Transport<ToRuntimeMessage, ToServerMessage> for RecordingTransport {
    type Sender = RecordingSender;
    type Receiver = mpsc::Receiver<ToServerMessage>;

    fn split(self) -> (Self::Sender, Self::Receiver) {
        (RecordingSender(self.outbound), self.inbound)
    }
}

impl TransportSender<ToRuntimeMessage> for RecordingSender {
    async fn send(&self, message: ToRuntimeMessage) -> std::result::Result<(), TransportError> {
        self.0
            .send(message)
            .await
            .map_err(|_| TransportError::Client("test receiver closed".to_owned()))
    }
}

#[derive(Clone)]
struct BlockingPromptLogs {
    repo: InMemoryAgentSessionRepo,
    entered: Arc<Notify>,
    release: Arc<Notify>,
    hang_disconnect: bool,
}

impl AgentSessionLogWriter for BlockingPromptLogs {
    async fn append(&mut self, log: AgentSessionLog) -> Result<()> {
        let is_prompt = matches!(
            &log.content,
            Message::ToRuntime(ToRuntimeMessage::Acp(AcpMessage(
                agent_client_protocol::RawJsonRpcMessage::Request(request)
            ))) if request.method.as_ref() == "session/prompt"
        );
        if is_prompt {
            self.entered.notify_one();
            self.release.notified().await;
        }
        AgentSessionLogRepo::create(&self.repo, log).await?;
        Ok(())
    }
}

fn owner_access(session: AgentSessionId) -> EntityAccessReceipt<OwnerAccessLevel> {
    EntityAccessReceipt::dangerously_assert_internal_user(
        &session.as_uuid().to_string(),
        EntityType::AgentSession,
    )
}

#[tokio::test]
async fn manual_rename_trims_persists_and_publishes() {
    let repo = InMemoryAgentSessionRepo::new();
    let session = test_session();
    repo.insert_session(test_agent_session(session));
    let realtime = RenameRealtime::default();
    let service = AgentSessionServiceImpl::new(
        repo.clone(),
        FoldedMessageService::new(repo.clone()),
        realtime.clone(),
    );

    service
        .rename_session(&owner_access(session), "  Fix Flaky Tests  ")
        .await
        .expect("rename session");

    let stored = repo.get(session).await.expect("get session");
    assert_eq!(stored.name, "Fix Flaky Tests");
    assert_eq!(
        realtime
            .0
            .lock()
            .expect("rename store is not poisoned")
            .as_slice(),
        &[AgentSessionRenamed {
            agent_session_id: session,
            name: "Fix Flaky Tests".to_owned(),
        }]
    );
}

#[tokio::test]
async fn manual_rename_rejects_blank_and_overlong_names() {
    let repo = InMemoryAgentSessionRepo::new();
    let session = test_session();
    repo.insert_session(test_agent_session(session));
    let service = AgentSessionServiceImpl::new(
        repo.clone(),
        FoldedMessageService::new(repo),
        RenameRealtime::default(),
    );

    assert!(matches!(
        service.rename_session(&owner_access(session), "  ").await,
        Err(AgentSessionError::InvalidName(_))
    ));
    assert!(matches!(
        service
            .rename_session(&owner_access(session), DEFAULT_AGENT_SESSION_NAME)
            .await,
        Err(AgentSessionError::InvalidName(_))
    ));
    assert!(matches!(
        service
            .rename_session(&owner_access(session), &"a".repeat(101))
            .await,
        Err(AgentSessionError::InvalidName(_))
    ));
}

#[tokio::test]
async fn manual_rename_rejects_access_for_another_entity_type() {
    let repo = InMemoryAgentSessionRepo::new();
    let session = test_session();
    repo.insert_session(test_agent_session(session));
    let service = AgentSessionServiceImpl::new(
        repo.clone(),
        FoldedMessageService::new(repo),
        RenameRealtime::default(),
    );
    let wrong_access = EntityAccessReceipt::<OwnerAccessLevel>::dangerously_assert_internal_user(
        &session.as_uuid().to_string(),
        EntityType::Document,
    );

    assert!(
        service
            .rename_session(&wrong_access, "New Name")
            .await
            .is_err()
    );
}

#[tokio::test]
async fn background_naming_persists_then_publishes_the_generated_name() {
    let repo = InMemoryAgentSessionRepo::new();
    let session = test_session();
    repo.insert_session(test_agent_session(session));
    let realtime = RenameRealtime::default();

    spawn_initial_agent_session_rename(
        repo.clone(),
        realtime.clone(),
        FixedNameGenerator,
        session,
        "fix the flaky tests".to_owned(),
    );
    for _ in 0..20 {
        if !realtime
            .0
            .lock()
            .expect("rename store is not poisoned")
            .is_empty()
        {
            break;
        }
        tokio::task::yield_now().await;
    }

    let stored = repo.get(session).await.expect("get session");
    assert_eq!(stored.name, "Fix Flaky Tests");
    assert_eq!(
        realtime
            .0
            .lock()
            .expect("rename store is not poisoned")
            .as_slice(),
        &[AgentSessionRenamed {
            agent_session_id: session,
            name: "Fix Flaky Tests".to_owned(),
        }]
    );
}

#[tokio::test]
async fn background_naming_does_not_overwrite_a_manual_name() {
    let repo = InMemoryAgentSessionRepo::new();
    let session = test_session();
    let mut stored = test_agent_session(session);
    stored.name = "Manual Name".to_owned();
    repo.insert_session(stored);
    let realtime = RenameRealtime::default();

    spawn_initial_agent_session_rename(
        repo.clone(),
        realtime.clone(),
        FixedNameGenerator,
        session,
        "fix the flaky tests".to_owned(),
    );
    for _ in 0..20 {
        tokio::task::yield_now().await;
    }

    assert_eq!(
        repo.get(session).await.expect("get session").name,
        "Manual Name"
    );
    assert!(
        realtime
            .0
            .lock()
            .expect("rename store is not poisoned")
            .is_empty()
    );
}

impl AgentSessionRepo for BlockingPromptLogs {
    async fn create(&self, params: CreateAgentSessionParams) -> Result<AgentSession> {
        AgentSessionRepo::create(&self.repo, params).await
    }

    async fn get(&self, id: AgentSessionId) -> Result<AgentSession> {
        self.repo.get(id).await
    }

    async fn session_bot(&self, id: BotId) -> Result<SessionBot> {
        self.repo.session_bot(id).await
    }

    async fn find_by_egress_token_hash(
        &self,
        egress_token_hash: &str,
    ) -> Result<Option<AgentSession>> {
        self.repo.find_by_egress_token_hash(egress_token_hash).await
    }

    async fn find_for_channel(
        &self,
        thread_id: Option<Uuid>,
        bot_id: Option<BotId>,
    ) -> Result<ChannelSession> {
        self.repo.find_for_channel(thread_id, bot_id).await
    }

    async fn find_all_for_thread(&self, thread_id: Uuid) -> Result<Vec<AgentSession>> {
        self.repo.find_all_for_thread(thread_id).await
    }

    async fn set_acp_session_id(
        &self,
        id: AgentSessionId,
        acp_session_id: SessionId,
    ) -> Result<()> {
        self.repo.set_acp_session_id(id, acp_session_id).await
    }

    async fn set_model(&self, id: AgentSessionId, model: &str) -> Result<()> {
        self.repo.set_model(id, model).await
    }

    async fn set_name(&self, id: AgentSessionId, name: &str) -> Result<()> {
        self.repo.set_name(id, name).await
    }

    async fn set_name_if_default(&self, id: AgentSessionId, name: &str) -> Result<bool> {
        self.repo.set_name_if_default(id, name).await
    }

    async fn set_sandbox_size(&self, id: AgentSessionId, size: SandboxSize) -> Result<()> {
        self.repo.set_sandbox_size(id, size).await
    }

    async fn user_sandbox_size(&self, user_id: &MacroUserIdStr<'static>) -> Result<SandboxSize> {
        self.repo.user_sandbox_size(user_id).await
    }

    async fn set_user_sandbox_size(
        &self,
        user_id: &MacroUserIdStr<'static>,
        size: SandboxSize,
    ) -> Result<()> {
        self.repo.set_user_sandbox_size(user_id, size).await
    }

    async fn delete(&self, id: AgentSessionId) -> Result<()> {
        self.repo.delete(id).await
    }
}

impl AgentSessionLogRepo for BlockingPromptLogs {
    async fn create(&self, log: AgentSessionLog) -> Result<StoredAgentSessionLog> {
        if self.hang_disconnect
            && matches!(
                &log.content,
                Message::ToServer(ToServerMessage::Event {
                    event: SystemEvent::Disconnected
                })
            )
        {
            return std::future::pending().await;
        }
        AgentSessionLogRepo::create(&self.repo, log).await
    }

    async fn list_by_session(
        &self,
        agent_session_id: AgentSessionId,
    ) -> Result<Vec<StoredAgentSessionLog>> {
        AgentSessionLogRepo::list_by_session(&self.repo, agent_session_id).await
    }
}

impl Transport<ToRuntimeMessage, ToServerMessage> for PendingTransport {
    type Sender = PendingSender;
    type Receiver = PendingReceiver;

    fn split(self) -> (Self::Sender, Self::Receiver) {
        (PendingSender, PendingReceiver)
    }
}

impl TransportSender<ToRuntimeMessage> for PendingSender {
    async fn send(&self, _message: ToRuntimeMessage) -> std::result::Result<(), TransportError> {
        Ok(())
    }
}

impl TransportReceiver<ToServerMessage> for PendingReceiver {
    async fn recv(&mut self) -> std::result::Result<Option<ToServerMessage>, TransportError> {
        std::future::pending().await
    }
}

async fn open_test_session(
    inbound: &mpsc::Sender<ToServerMessage>,
    outbound: &mut mpsc::Receiver<ToRuntimeMessage>,
    session: AgentSessionId,
) {
    inbound
        .send(ToServerMessage::Event {
            event: SystemEvent::AcpReady,
        })
        .await
        .unwrap();
    let _initialize = outbound.recv().await.expect("initialize request");
    inbound
        .send(ToServerMessage::Acp(AcpMessage(
            agent_client_protocol::RawJsonRpcMessage::response(
                agent_client_protocol::schema::v1::RequestId::Str(format!(
                    "agent_session:{session}:0"
                )),
                Ok(serde_json::to_value(
                    agent_client_protocol::schema::v1::InitializeResponse::new(PROTOCOL_VERSION),
                )
                .unwrap()),
            ),
        )))
        .await
        .unwrap();
    let _open = outbound.recv().await.expect("session/new request");
    inbound
        .send(ToServerMessage::Acp(AcpMessage(
            agent_client_protocol::RawJsonRpcMessage::response(
                agent_client_protocol::schema::v1::RequestId::Str(format!(
                    "agent_session:{session}:1"
                )),
                Ok(serde_json::to_value(
                    agent_client_protocol::schema::v1::NewSessionResponse::new("acp-1"),
                )
                .unwrap()),
            ),
        )))
        .await
        .unwrap();
}

#[tokio::test]
async fn a_stopping_lifecycle_entry_blocks_a_second_attach() {
    let fx = fixture();
    let (_stopped, marker) = fx.service.begin_stop(fx.session, false);

    let result = fx
        .service
        .attach_session(fx.session, RuntimeAttachment::solo(PendingTransport))
        .await;

    assert!(matches!(result, Err(AgentSessionError::AlreadyConnected(id)) if id == fx.session));
    fx.service.active.remove_if(&fx.session, |_, active| {
        Arc::ptr_eq(&active.marker, &marker)
    });
}

#[tokio::test]
async fn close_claiming_an_attach_reservation_prevents_actor_start() {
    let fx = fixture();
    let reservation = fx
        .service
        .reserve_attach(fx.session)
        .await
        .expect("attach reserves before reading");
    let session = fx.repo.get(fx.session).await.expect("session exists");
    let (stopped, marker) = fx.service.begin_stop(fx.session, false);

    let result = fx
        .service
        .activate_reserved(
            session,
            RuntimeAttachment::solo(PendingTransport),
            reservation,
        )
        .await;
    AgentSessionServiceImpl::<
        InMemoryAgentSessionRepo,
        FoldedMessageService<InMemoryAgentSessionRepo>,
        NoOpRealtime,
    >::wait_stopped(stopped)
    .await;

    assert!(matches!(result, Err(AgentSessionError::Disconnected(id)) if id == fx.session));
    assert!(
        fx.service
            .active
            .get(&fx.session)
            .unwrap()
            .commands
            .is_none()
    );
    fx.service.active.remove_if(&fx.session, |_, active| {
        Arc::ptr_eq(&active.marker, &marker)
    });
}

#[tokio::test]
async fn shutdown_prevents_a_reserved_attach_from_spawning() {
    let fx = fixture();
    let reservation = fx
        .service
        .reserve_attach(fx.session)
        .await
        .expect("attach reserves before reading");
    let session = fx.repo.get(fx.session).await.expect("session exists");

    fx.service.shutdown().await;
    let result = fx
        .service
        .activate_reserved(
            session,
            RuntimeAttachment::solo(PendingTransport),
            reservation,
        )
        .await;

    assert!(matches!(result, Err(AgentSessionError::Disconnected(id)) if id == fx.session));
    assert!(fx.service.tasks.is_closed());
}

#[tokio::test]
async fn close_does_not_remove_a_concurrent_delete_guard() {
    let fx = fixture();
    let (_stopped, marker) = fx.service.begin_stop(fx.session, true);

    fx.service
        .close_session(fx.session)
        .await
        .expect("close observes the stopped actor");

    assert!(fx.service.active.contains_key(&fx.session));
    fx.service.active.remove_if(&fx.session, |_, active| {
        Arc::ptr_eq(&active.marker, &marker)
    });
}

/// A command sent while the handshake never completes cannot hang its caller
/// forever - see [`HANDSHAKE_TIMEOUT`]. Without that bound, this test would
/// simply never finish. The actor it was stuck in cannot linger afterwards
/// either: its `commands` sender is gone from `active`, the same signal
/// `close_session` relies on to mean the actor tore itself down.
#[tokio::test]
async fn a_command_stuck_behind_a_stalled_handshake_times_out_as_disconnected() {
    let fx = fixture();
    fx.service
        .attach_session(fx.session, RuntimeAttachment::solo(PendingTransport))
        .await
        .expect("attach succeeds");

    let result = fx
        .service
        .send_action(
            fx.session,
            None,
            AgentAction::prompt("hello"),
            AgentActionId::mint(),
        )
        .await;

    assert!(
        matches!(result, Err(AgentSessionError::Disconnected(id)) if id == fx.session),
        "a stalled handshake times out rather than hanging forever, got {result:?}"
    );
    assert!(
        fx.service
            .active
            .get(&fx.session)
            .is_none_or(|active| active.commands.is_none()),
        "the stuck actor's connector is released, not left running"
    );
}

#[tokio::test]
async fn cancellation_does_not_drop_an_effect_batch_after_machine_mutation() {
    let repo = InMemoryAgentSessionRepo::new();
    let session = test_session();
    repo.insert_session(test_agent_session(session));
    let entered = Arc::new(Notify::new());
    let release = Arc::new(Notify::new());
    let logs = BlockingPromptLogs {
        repo: repo.clone(),
        entered: entered.clone(),
        release: release.clone(),
        hang_disconnect: false,
    };
    let (outbound_tx, mut outbound_rx) = mpsc::channel(8);
    let (inbound_tx, inbound_rx) = mpsc::channel(8);
    let (commands, command_rx) = mpsc::channel(8);
    let (handshake, _) = watch::channel(HandshakeStatus::Pending);
    let actor = SessionActor::new(
        session,
        None,
        "/workspace".to_owned(),
        Vec::new(),
        RecordingTransport {
            outbound: outbound_tx,
            inbound: inbound_rx,
        },
        logs,
        command_rx,
        handshake,
    );
    let active = Arc::new(ActiveSessions::new());
    let cancellation = CancellationToken::new();
    let marker = Arc::new(());
    let (stopped_tx, _) = watch::channel(false);
    let task = tokio::spawn(run_session(
        actor,
        Arc::downgrade(&active),
        marker,
        stopped_tx,
        cancellation.clone(),
    ));

    open_test_session(&inbound_tx, &mut outbound_rx, session).await;

    let (completed, result) = oneshot::channel();
    commands
        .send(SessionCommand {
            user_id: None,
            action: AgentAction::prompt("keep dispatching"),
            action_id: AgentActionId::mint(),
            completed,
            span: tracing::info_span!("test.command"),
            enqueued_at: tokio::time::Instant::now(),
        })
        .await
        .unwrap();
    entered.notified().await;
    cancellation.cancel();
    release.notify_one();

    let prompt = outbound_rx
        .recv()
        .await
        .expect("prompt is still dispatched");
    assert!(matches!(
        prompt,
        ToRuntimeMessage::Acp(AcpMessage(
            agent_client_protocol::RawJsonRpcMessage::Request(request)
        )) if request.method.as_ref() == "session/prompt"
    ));
    result.await.unwrap().expect("delivery completes");
    task.await.unwrap();
}

#[tokio::test(start_paused = true)]
async fn live_inbound_logs_do_not_reuse_the_expired_handshake_deadline() {
    let repo = InMemoryAgentSessionRepo::new();
    let session = test_session();
    repo.insert_session(test_agent_session(session));
    let entered = Arc::new(Notify::new());
    let release = Arc::new(Notify::new());
    let logs = BlockingPromptLogs {
        repo: repo.clone(),
        entered: entered.clone(),
        release: release.clone(),
        hang_disconnect: false,
    };
    let (outbound_tx, mut outbound_rx) = mpsc::channel(8);
    let (inbound_tx, inbound_rx) = mpsc::channel(8);
    let (commands, command_rx) = mpsc::channel(8);
    let (handshake, _) = watch::channel(HandshakeStatus::Pending);
    let actor = SessionActor::new(
        session,
        None,
        "/workspace".to_owned(),
        Vec::new(),
        RecordingTransport {
            outbound: outbound_tx,
            inbound: inbound_rx,
        },
        logs,
        command_rx,
        handshake,
    );
    let active = Arc::new(ActiveSessions::new());
    let cancellation = CancellationToken::new();
    let (stopped_tx, _) = watch::channel(false);
    let task = tokio::spawn(
        run_session(
            actor,
            Arc::downgrade(&active),
            Arc::new(()),
            stopped_tx,
            cancellation.clone(),
        )
        .with_current_subscriber(),
    );
    open_test_session(&inbound_tx, &mut outbound_rx, session).await;

    release.notify_one();
    let (completed, result) = oneshot::channel();
    commands
        .send(SessionCommand {
            user_id: None,
            action: AgentAction::prompt("keep working"),
            action_id: AgentActionId::mint(),
            completed,
            span: tracing::info_span!("test.command"),
            enqueued_at: tokio::time::Instant::now(),
        })
        .await
        .unwrap();
    entered.notified().await;
    let _prompt = outbound_rx.recv().await.expect("prompt request");
    result.await.unwrap().expect("prompt delivered");

    tokio::time::advance(std::time::Duration::from_secs(61)).await;
    inbound_tx
        .send(ToServerMessage::Acp(AcpMessage(
            agent_client_protocol::RawJsonRpcMessage::notification(
                "session/update".to_owned(),
                serde_json::json!({ "sessionId": "acp-1", "update": {} }),
            )
            .unwrap(),
        )))
        .await
        .unwrap();

    let mut persisted = false;
    for _ in 0..20 {
        tokio::task::yield_now().await;
        persisted = AgentSessionLogRepo::list_by_session(&repo, session)
            .await
            .unwrap()
            .iter()
            .any(|stored| {
                matches!(
                    &stored.entry.content,
                    Message::ToServer(ToServerMessage::Acp(AcpMessage(
                        agent_client_protocol::RawJsonRpcMessage::Notification(notification)
                    ))) if notification.method.as_ref() == "session/update"
                )
            });
        if persisted {
            break;
        }
    }
    assert!(persisted, "live update should use the regular log timeout");

    cancellation.cancel();
    task.await.unwrap();
}

/// Any protocol frame will do: the service only stores it, turn detection is
/// the fold's answer.
fn any_event(session: AgentSessionId) -> AgentSessionLog {
    AgentSessionLog {
        agent_session_id: session,
        user_id: None,
        content: Message::ToServer(ToServerMessage::Event {
            event: agent_runtime_protocol::domain::schema::v0::SystemEvent::AcpReady,
        }),
    }
}

// A live session's frames go into `LiveSessionLogWriter`, which the actor
// owns. These pin that path.

/// A `LiveSessionLogWriter` over the given store, as `register_transport`
/// builds one for a connection - with nobody watching its channel.
fn connection(
    repo: InMemoryAgentSessionRepo,
) -> LiveSessionLogWriter<InMemoryAgentSessionRepo, NoOpRealtime> {
    streaming_connection(repo, NoOpRealtime)
}

/// The same connection, publishing its frames somewhere a test can read them.
fn streaming_connection<Rt>(
    repo: InMemoryAgentSessionRepo,
    realtime: Rt,
) -> LiveSessionLogWriter<InMemoryAgentSessionRepo, Rt>
where
    Rt: AgentSessionRealtime + Send + Sync + 'static,
{
    LiveSessionLogWriter::new(repo, realtime)
}

/// Every frame handed to a connection is stored, whether or not it derives
/// anything.
#[tokio::test]
async fn appending_persists_the_event() {
    let fx = fixture();
    let mut logs = connection(fx.repo.clone());

    AgentSessionLogWriter::append(&mut logs, any_event(fx.session))
        .await
        .expect("append succeeds");
    AgentSessionLogWriter::append(&mut logs, any_event(fx.session))
        .await
        .expect("append succeeds");

    let log = AgentSessionLogRepo::list_by_session(&fx.repo, fx.session)
        .await
        .expect("in-memory repo cannot fail");
    assert_eq!(log.len(), 2);
}

#[tokio::test]
async fn marking_disconnected_persists_and_publishes_the_event() {
    let repo = InMemoryAgentSessionRepo::new();
    let session = test_session();
    repo.insert_session(test_agent_session(session));
    let realtime = RecordingRealtime::new();
    let service = AgentSessionServiceImpl::new(
        repo.clone(),
        FoldedMessageService::new(repo.clone()),
        realtime.clone(),
    );

    service
        .mark_disconnected(session)
        .await
        .expect("disconnect is recorded");

    let stored = AgentSessionLogRepo::list_by_session(&repo, session)
        .await
        .expect("stored log can be read");
    assert!(matches!(
        &stored[..],
        [StoredAgentSessionLog {
            entry: AgentSessionLog {
                content: Message::ToServer(ToServerMessage::Event {
                    event: SystemEvent::Disconnected,
                }),
                ..
            },
            ..
        }]
    ));
    assert_eq!(realtime.published().len(), 1);
}

#[tokio::test(start_paused = true)]
async fn marking_disconnected_is_bounded_when_persistence_hangs() {
    let repo = InMemoryAgentSessionRepo::new();
    let session = test_session();
    repo.insert_session(test_agent_session(session));
    let hanging = BlockingPromptLogs {
        repo: repo.clone(),
        entered: Arc::new(Notify::new()),
        release: Arc::new(Notify::new()),
        hang_disconnect: true,
    };
    let service =
        AgentSessionServiceImpl::new(hanging, FoldedMessageService::new(repo), NoOpRealtime);
    let disconnect = tokio::spawn(async move { service.mark_disconnected(session).await });
    tokio::task::yield_now().await;
    tokio::time::advance(SESSION_PERSIST_TIMEOUT).await;

    assert!(matches!(
        disconnect.await.unwrap(),
        Err(AgentSessionError::LogTimedOut(id)) if id == session
    ));
}

/// The point of the rework: a connection folds its session once, when it
/// starts, and every frame after that is folded into the state it kept.
///
/// Reading the whole log is what folding from scratch costs, so a read per
/// frame is exactly the quadratic behaviour this replaced.
#[tokio::test]
async fn a_connection_reads_the_log_once_however_many_frames_arrive() {
    let repo = InMemoryAgentSessionRepo::new();
    repo.insert_session(test_agent_session(test_session()));
    let mut logs = connection(repo.clone());

    let log = parse_log_as(test_session(), TURN);
    let frames = log.len();
    assert!(frames > 5, "the fixture is worth counting reads over");

    for entry in log {
        AgentSessionLogWriter::append(&mut logs, entry)
            .await
            .expect("append succeeds");
    }

    assert_eq!(
        repo.log_reads(),
        1,
        "{frames} frames should cost one fold, not one per frame"
    );
}

// Streaming: the writer every frame of a connected session passes through
// pushes each one at whoever is watching the channel right now.

/// Every frame a connection writes goes out once, addressed at the session's
/// channel and carrying the frame verbatim - a viewer folds what it is sent
/// with the same code that folds the fetched log, so anything altered on the
/// way out would fold to something else.
#[tokio::test]
async fn a_connections_frames_are_published_to_its_channel() {
    let repo = InMemoryAgentSessionRepo::new();
    repo.insert_session(test_agent_session(test_session()));
    let realtime = RecordingRealtime::new();
    let mut logs = streaming_connection(repo.clone(), realtime.clone());

    let log = parse_log_as(test_session(), TURN);
    for entry in log.clone() {
        AgentSessionLogWriter::append(&mut logs, entry)
            .await
            .expect("append succeeds");
    }

    let published = realtime.published();
    assert_eq!(published.len(), log.len(), "one event per frame, no more");
    assert!(
        published
            .iter()
            .all(|event| event.agent_session_id == test_session()),
        "every event names the session"
    );
    let stored = AgentSessionLogRepo::list_by_session(&repo, test_session())
        .await
        .expect("stored log can be read");
    assert_eq!(
        published
            .iter()
            .map(|event| event.entry.created_at)
            .collect::<Vec<_>>(),
        stored
            .iter()
            .map(|entry| entry.created_at)
            .collect::<Vec<_>>(),
        "published timestamps are the timestamps assigned by persistence"
    );
    // Compared as the JSON they are published as: the client folds these
    // bytes with the same code it folds the fetched log with.
    let frame = |entry: AgentSessionLog| {
        (
            entry.user_id.map(|user| user.to_string()),
            serde_json::to_value(entry.content).expect("a frame serializes"),
        )
    };
    assert_eq!(
        published
            .into_iter()
            .map(|event| frame(event.entry.entry))
            .collect::<Vec<_>>(),
        log.into_iter().map(frame).collect::<Vec<_>>(),
        "the frames go out as they were logged"
    );
}

/// Streaming costs the connection one session lookup, not one per frame.
///
/// Most frames are stream chunks that otherwise cost nothing but the log
/// insert, so the audience lookup must not be per frame.
#[tokio::test]
async fn streaming_costs_one_session_lookup_for_the_whole_connection() {
    /// Replay the fixture through a connection publishing to `realtime`, and
    /// report what it read and how many frames it took to get there.
    async fn replay<Rt>(realtime: Rt) -> (usize, usize)
    where
        Rt: AgentSessionRealtime + Send + Sync + 'static,
    {
        let repo = InMemoryAgentSessionRepo::new();
        repo.insert_session(test_agent_session(test_session()));
        let mut logs = streaming_connection(repo.clone(), realtime);

        let log = parse_log_as(test_session(), TURN);
        let frames = log.len();
        for entry in log {
            AgentSessionLogWriter::append(&mut logs, entry)
                .await
                .expect("append succeeds");
        }
        (repo.session_reads(), frames)
    }

    let (streamed, frames) = replay(RecordingRealtime::new()).await;
    let (silent, _) = replay(NoOpRealtime).await;

    assert!(frames > 5, "the fixture is worth counting reads over");
    assert!(
        streamed <= silent + 1,
        "{frames} streamed frames read the session {streamed} times against \
         {silent} unstreamed - that is a lookup per frame, not one per connection"
    );
}

/// A publisher that is down costs a viewer some liveness and nothing else:
/// the append succeeds and the log is written.
#[tokio::test]
async fn a_failed_publish_does_not_fail_the_append() {
    let repo = InMemoryAgentSessionRepo::new();
    repo.insert_session(test_agent_session(test_session()));
    let mut logs = streaming_connection(repo.clone(), RecordingRealtime::down());

    let log = parse_log_as(test_session(), TURN);
    let frames = log.len();
    for entry in log {
        AgentSessionLogWriter::append(&mut logs, entry)
            .await
            .expect("a refused publish does not fail the append");
    }

    let stored = AgentSessionLogRepo::list_by_session(&repo, test_session())
        .await
        .expect("in-memory repo cannot fail");
    assert_eq!(stored.len(), frames, "every frame is still durable");
}

/// `session_log` hands back the log unfolded, in order, with the agent that
/// wrote it.
#[tokio::test]
async fn session_log_returns_the_sessions_frames_in_order() {
    let store = InMemoryAgentSessionRepo::new();
    store.insert_session(test_agent_session(test_session()));
    let recorded = parse_log_as(test_session(), TURN);
    store.extend_log(recorded.clone());

    let service = AgentSessionServiceImpl::new(
        store.clone(),
        FoldedMessageService::new(store.clone()),
        NoOpRealtime,
    );

    let log = service
        .session_log(test_session())
        .await
        .expect("lookup succeeds");

    assert_eq!(
        log.entries.len(),
        recorded.len(),
        "every frame is served, none folded away"
    );
    assert!(!log.bot.name.is_empty(), "the response names the agent");

    // The order is the contract: folding is a left fold from the first frame,
    // so a reordered log derives different turn numbering.
    let served = fold(log.entries.into_iter().map(|stored| stored.entry));
    assert_eq!(
        served,
        fold(recorded),
        "the served log folds to what the stored one does"
    );
}

/// A session that never existed is an error: the response has to name the
/// session's agent, and there is none to name.
#[tokio::test]
async fn session_log_of_an_unknown_session_errors() {
    let fx = fixture();

    let log = fx.service.session_log(AgentSessionId::TEST_A).await;

    assert!(log.is_err());
}

/// A config-bearing response moves the fold's model, and the writer projects
/// it onto the session row; an error response projects nothing.
#[tokio::test]
async fn appending_a_config_response_projects_the_model() {
    let fx = fixture();
    let mut logs = connection(fx.repo.clone());

    let frames = parse_log_as(
        fx.session,
        concat!(
            r#"{"direction":"to_runtime","content":{"type":"acp","jsonrpc":"2.0","id":"n","method":"session/new","params":{"cwd":"/w","mcpServers":[]}}}"#,
            "\n",
            r#"{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","id":"n","result":{"sessionId":"s1","configOptions":[{"id":"model","name":"Model","type":"select","currentValue":"sonnet","options":[{"value":"sonnet","name":"Sonnet"},{"value":"opus","name":"Opus"}]}]}}}"#,
            "\n",
            r#"{"direction":"to_runtime","content":{"type":"acp","jsonrpc":"2.0","id":"c","method":"session/set_config_option","params":{"sessionId":"s1","configId":"model","value":"claude-fable-5"}}}"#,
            "\n",
            r#"{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","id":"c","error":{"code":-32602,"message":"Invalid params: model not found: claude-fable-5"}}}"#,
        ),
    );
    for frame in frames {
        AgentSessionLogWriter::append(&mut logs, frame)
            .await
            .expect("append succeeds");
    }

    let session = AgentSessionRepo::get(&fx.repo, fx.session)
        .await
        .expect("get session");
    assert_eq!(session.model, "sonnet", "the rejected change moved nothing");
}
