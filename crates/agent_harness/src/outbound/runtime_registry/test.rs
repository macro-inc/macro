//! Binding rules of the registry: what a session finds when it looks for its
//! bot's runtime - resolved through the bot's harness binding - and what a
//! redial does to whatever was there.

use std::collections::HashMap;
use std::future::Future;
use std::sync::Mutex;

use super::*;
use crate::domain::ports::HarnessConnection;
use crate::testing::helpers::containers::{ContainerMock, ContainerSender};

/// Static bot-to-harness bindings for tests.
#[derive(Default)]
struct FakeBindings {
    bindings: Mutex<HashMap<BotId, HarnessId>>,
}

impl FakeBindings {
    fn bound(bot: BotId, harness: HarnessId) -> Self {
        let bindings = Self::default();
        bindings.bindings.lock().unwrap().insert(bot, harness);
        bindings
    }
}

impl HarnessBindings for Arc<FakeBindings> {
    async fn harness_for(&self, bot: BotId) -> anyhow::Result<Option<HarnessId>> {
        Ok(self.bindings.lock().unwrap().get(&bot).copied())
    }

    async fn access_facts(
        &self,
        _bot: BotId,
        _actor: Option<&macro_user_id::user_id::MacroUserIdStr<'static>>,
    ) -> anyhow::Result<Option<crate::domain::model::RuntimeAccessFacts>> {
        Ok(None)
    }

    async fn sessions_on_harness(
        &self,
        _harness: HarnessId,
        _acp_sessions: &[SessionId],
    ) -> anyhow::Result<crate::domain::model::ListedSessions> {
        Ok(crate::domain::model::ListedSessions::default())
    }
}

fn connections<Sender>(
    bindings: Arc<FakeBindings>,
    registry: &Arc<RuntimeRegistry<Sender>>,
) -> HarnessKeyedConnections<Arc<FakeBindings>, Sender> {
    HarnessKeyedConnections::new(bindings, Arc::clone(registry))
}

#[tokio::test]
async fn a_harness_with_no_runtime_has_nothing_to_bind_to() {
    let registry = RuntimeRegistry::<ContainerSender>::new();
    let bound = connections(
        Arc::new(FakeBindings::bound(BotId::TEST_A, HarnessId::TEST_A)),
        &registry,
    );

    assert!(!registry.is_connected(HarnessId::TEST_A));
    assert!(
        bound
            .bind(BotId::TEST_A, AgentSessionId::TEST_A)
            .await
            .is_none()
    );
}

#[tokio::test]
async fn a_session_binds_onto_its_harness_connection() {
    let registry = RuntimeRegistry::new();
    registry.attach(HarnessId::TEST_A, ContainerMock::default());
    let bound = connections(
        Arc::new(FakeBindings::bound(BotId::TEST_A, HarnessId::TEST_A)),
        &registry,
    );

    assert!(registry.is_connected(HarnessId::TEST_A));
    assert!(
        bound
            .bind(BotId::TEST_A, AgentSessionId::TEST_A)
            .await
            .is_some()
    );
    // An unbound bot finds nothing, whatever is connected.
    assert!(
        bound
            .bind(BotId::TEST_B, AgentSessionId::TEST_A)
            .await
            .is_none()
    );
}

#[tokio::test]
async fn a_bot_bound_to_a_disconnected_harness_has_nothing_to_bind_to() {
    let registry = RuntimeRegistry::new();
    registry.attach(HarnessId::TEST_A, ContainerMock::default());
    let bound = connections(
        Arc::new(FakeBindings::bound(BotId::TEST_A, HarnessId::TEST_B)),
        &registry,
    );

    assert!(
        bound
            .bind(BotId::TEST_A, AgentSessionId::TEST_A)
            .await
            .is_none()
    );
}

#[tokio::test]
async fn many_bots_sessions_share_one_harness_connection() {
    let registry = RuntimeRegistry::new();
    registry.attach(HarnessId::TEST_A, ContainerMock::default());
    let bindings = Arc::new(FakeBindings::bound(BotId::TEST_A, HarnessId::TEST_A));
    bindings
        .bindings
        .lock()
        .unwrap()
        .insert(BotId::TEST_B, HarnessId::TEST_A);
    let bound = connections(bindings, &registry);

    assert!(
        bound
            .bind(BotId::TEST_A, AgentSessionId::TEST_A)
            .await
            .is_some()
    );
    assert!(
        bound
            .bind(BotId::TEST_B, AgentSessionId::TEST_B)
            .await
            .is_some()
    );
}

#[tokio::test]
async fn a_redial_displaces_the_previous_connection() {
    let registry = RuntimeRegistry::new();
    registry.attach(HarnessId::TEST_A, ContainerMock::default());
    let bound = connections(
        Arc::new(FakeBindings::bound(BotId::TEST_A, HarnessId::TEST_A)),
        &registry,
    );
    bound
        .bind(BotId::TEST_A, AgentSessionId::TEST_A)
        .await
        .expect("the first dial is bindable");

    registry.attach(HarnessId::TEST_A, ContainerMock::default());

    // Displacing leaves the harness connected, and the session that was riding
    // on the old connection binds again onto the new one - which is how a
    // reconnect restores it.
    assert!(registry.is_connected(HarnessId::TEST_A));
    assert!(
        bound
            .bind(BotId::TEST_A, AgentSessionId::TEST_A)
            .await
            .is_some()
    );
}

#[tokio::test]
async fn a_closed_connection_is_unlisted_so_nothing_binds_onto_it() {
    let registry = RuntimeRegistry::new();
    let runtime = ContainerMock::default();
    registry.attach(HarnessId::TEST_A, runtime.clone());
    let connection = registry
        .connections
        .get(&HarnessId::TEST_A)
        .map(|entry| entry.value().clone())
        .expect("the dial is listed");
    let bound = connections(
        Arc::new(FakeBindings::bound(BotId::TEST_A, HarnessId::TEST_A)),
        &registry,
    );

    runtime.disconnects();
    // The same work `attach` spawns, awaited here rather than raced.
    Arc::clone(&registry)
        .drop_when_closed(HarnessId::TEST_A, connection, None)
        .await;

    assert!(!registry.is_connected(HarnessId::TEST_A));
    assert!(
        bound
            .bind(BotId::TEST_A, AgentSessionId::TEST_A)
            .await
            .is_none()
    );
}

#[tokio::test]
async fn a_redials_connection_outlives_the_one_it_displaced() {
    let registry = RuntimeRegistry::new();
    let first = ContainerMock::default();
    registry.attach(HarnessId::TEST_A, first.clone());
    let displaced = registry
        .connections
        .get(&HarnessId::TEST_A)
        .map(|entry| entry.value().clone())
        .expect("the first dial is listed");
    let bound = connections(
        Arc::new(FakeBindings::bound(BotId::TEST_A, HarnessId::TEST_A)),
        &registry,
    );

    registry.attach(HarnessId::TEST_A, ContainerMock::default());
    first.disconnects();
    Arc::clone(&registry)
        .drop_when_closed(HarnessId::TEST_A, displaced, None)
        .await;

    // The dead connection's eviction must not unlist the live one that took
    // its place, or a redial would leave the harness unreachable.
    assert!(registry.is_connected(HarnessId::TEST_A));
    assert!(
        bound
            .bind(BotId::TEST_A, AgentSessionId::TEST_A)
            .await
            .is_some()
    );
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PresenceEvent {
    Connected(RuntimeConnectionId),
    Disconnected(RuntimeConnectionId),
}

#[derive(Default)]
struct RecordingPresence {
    /// Whether recording a connection binds an agent.
    binds_an_agent: bool,
    events: Mutex<Vec<PresenceEvent>>,
    renewed: Mutex<Vec<Vec<(HarnessId, RuntimeConnectionId)>>>,
}

impl HarnessPresence for RecordingPresence {
    fn connected(
        self: Arc<Self>,
        _harness: HarnessId,
        connection: RuntimeConnectionId,
        _accepts: RuntimeAccepts,
    ) -> std::pin::Pin<Box<dyn Future<Output = ConnectionRecorded> + Send>> {
        Box::pin(async move {
            self.events
                .lock()
                .unwrap()
                .push(PresenceEvent::Connected(connection));
            if self.binds_an_agent {
                ConnectionRecorded::AgentBound
            } else {
                ConnectionRecorded::AgentsUnchanged
            }
        })
    }

    fn disconnected(
        self: Arc<Self>,
        _harness: HarnessId,
        connection: RuntimeConnectionId,
    ) -> std::pin::Pin<Box<dyn Future<Output = ()> + Send>> {
        Box::pin(async move {
            self.events
                .lock()
                .unwrap()
                .push(PresenceEvent::Disconnected(connection));
        })
    }

    fn renew(
        self: Arc<Self>,
        live: Vec<HarnessConnection>,
    ) -> std::pin::Pin<Box<dyn Future<Output = Vec<HarnessConnection>> + Send>> {
        Box::pin(async move {
            self.renewed.lock().unwrap().push(live);
            Vec::new()
        })
    }
}

fn registry_with_presence(
    presence: &Arc<RecordingPresence>,
) -> Arc<RuntimeRegistry<ContainerSender>> {
    RuntimeRegistry::with_presence(
        Arc::clone(presence) as Arc<dyn HarnessPresence>,
        mpsc::unbounded_channel().0,
    )
}

fn listed_connection(
    registry: &Arc<RuntimeRegistry<ContainerSender>>,
) -> ListedConnection<ContainerSender> {
    registry
        .connections
        .get(&HarnessId::TEST_A)
        .map(|entry| entry.value().clone())
        .expect("the dial is listed")
}

#[tokio::test]
async fn a_displaced_connections_close_reports_only_that_connection() {
    let presence = Arc::new(RecordingPresence::default());
    let registry = registry_with_presence(&presence);
    let first = ContainerMock::default();
    registry.attach(HarnessId::TEST_A, first.clone());
    let displaced = listed_connection(&registry);
    registry.attach(HarnessId::TEST_A, ContainerMock::default());
    let current = listed_connection(&registry);

    first.disconnects();
    Arc::clone(&registry)
        .drop_when_closed(HarnessId::TEST_A, displaced.clone(), None)
        .await;

    // Presence is told about the dead connection, by name, so its write cannot
    // be mistaken for the live connection going away.
    let events = presence.events.lock().unwrap().clone();
    assert!(events.contains(&PresenceEvent::Disconnected(displaced.id)));
    assert!(!events.contains(&PresenceEvent::Disconnected(current.id)));
    assert_eq!(listed_connection(&registry).id, current.id);
}

#[tokio::test(start_paused = true)]
async fn a_close_waits_for_its_own_connected_write() {
    let presence = Arc::new(RecordingPresence::default());
    let registry = registry_with_presence(&presence);
    let runtime = ContainerMock::default();
    // Not through `attach`, whose own watch would report the close unprompted.
    let listed = ListedConnection {
        id: RuntimeConnectionId::generate(),
        connection: RuntimeConnection::connect(runtime.clone()),
        accepts: RuntimeAccepts {
            agents_changed: true,
            apply_agent: false,
            ..RuntimeAccepts::default()
        },
    };
    registry
        .connections
        .insert(HarnessId::TEST_A, listed.clone());
    let (release, released) = tokio::sync::oneshot::channel::<()>();
    let connected_write = tokio::spawn({
        let presence = Arc::clone(&presence);
        let id = listed.id;
        async move {
            let _ = released.await;
            presence
                .events
                .lock()
                .unwrap()
                .push(PresenceEvent::Connected(id));
        }
    });
    runtime.disconnects();

    let closing = Arc::clone(&registry).drop_when_closed(
        HarnessId::TEST_A,
        listed.clone(),
        Some(connected_write),
    );
    tokio::pin!(closing);
    tokio::select! {
        () = &mut closing => panic!("the close finished before its attach was recorded"),
        () = tokio::time::sleep(Duration::from_secs(1)) => {}
    }
    // The registry already stopped listing it; only the presence write waited.
    assert!(!registry.is_connected(HarnessId::TEST_A));
    assert!(presence.events.lock().unwrap().is_empty());

    release.send(()).expect("the connected write is waiting");
    closing.await;

    assert_eq!(
        *presence.events.lock().unwrap(),
        [
            PresenceEvent::Connected(listed.id),
            PresenceEvent::Disconnected(listed.id)
        ]
    );
}

/// The dial that binds an agent tells its runtime to re-read its agents,
/// once presence has it.
#[tokio::test]
async fn a_dial_that_binds_an_agent_tells_its_runtime_its_agents_changed() {
    let presence = Arc::new(RecordingPresence {
        binds_an_agent: true,
        ..RecordingPresence::default()
    });
    let runtime = ContainerMock::default();
    let listed = ListedConnection {
        id: RuntimeConnectionId::generate(),
        connection: RuntimeConnection::connect(runtime.clone()),
        accepts: RuntimeAccepts {
            agents_changed: true,
            apply_agent: false,
            ..RuntimeAccepts::default()
        },
    };

    record_connected(
        Arc::clone(&presence) as Arc<dyn HarnessPresence>,
        HarnessId::TEST_A,
        listed.clone(),
    )
    .await;

    assert_eq!(
        *presence.events.lock().unwrap(),
        [PresenceEvent::Connected(listed.id)]
    );
    assert!(matches!(
        runtime.sent().as_slice(),
        [ToRuntimeMessage::AgentsChanged]
    ));
}

/// A runtime that did not say it accepts the message never gets it, even
/// on the dial that bound its first agent: it would log it as malformed.
#[tokio::test]
async fn a_runtime_that_does_not_accept_agents_changed_is_never_sent_it() {
    let presence = Arc::new(RecordingPresence {
        binds_an_agent: true,
        ..RecordingPresence::default()
    });
    let runtime = ContainerMock::default();
    let listed = ListedConnection {
        id: RuntimeConnectionId::generate(),
        connection: RuntimeConnection::connect(runtime.clone()),
        accepts: RuntimeAccepts::default(),
    };

    record_connected(
        Arc::clone(&presence) as Arc<dyn HarnessPresence>,
        HarnessId::TEST_A,
        listed.clone(),
    )
    .await;

    assert!(runtime.sent().is_empty(), "{:?}", runtime.sent());
}

/// Every other dial sends nothing new: a runtime too old to know the
/// message must never be sent it.
#[tokio::test]
async fn a_dial_that_binds_nothing_sends_its_runtime_nothing() {
    let presence = Arc::new(RecordingPresence::default());
    let runtime = ContainerMock::default();
    let listed = ListedConnection {
        id: RuntimeConnectionId::generate(),
        connection: RuntimeConnection::connect(runtime.clone()),
        accepts: RuntimeAccepts {
            agents_changed: true,
            apply_agent: false,
            ..RuntimeAccepts::default()
        },
    };

    record_connected(
        Arc::clone(&presence) as Arc<dyn HarnessPresence>,
        HarnessId::TEST_A,
        listed.clone(),
    )
    .await;

    assert_eq!(
        *presence.events.lock().unwrap(),
        [PresenceEvent::Connected(listed.id)]
    );
    assert!(runtime.sent().is_empty(), "{:?}", runtime.sent());
}

#[tokio::test]
async fn renewal_lists_the_connections_this_process_holds() {
    let presence = Arc::new(RecordingPresence::default());
    let registry = registry_with_presence(&presence);

    registry.renew_presence().await;
    assert!(presence.renewed.lock().unwrap().is_empty());

    registry.attach(HarnessId::TEST_A, ContainerMock::default());
    let listed = listed_connection(&registry);
    registry.renew_presence().await;

    assert_eq!(
        *presence.renewed.lock().unwrap(),
        [vec![(HarnessId::TEST_A, listed.id)]]
    );
}

#[tokio::test]
async fn a_dial_initializes_and_reports_the_sessions_its_runtime_lists() {
    let (live_sessions, mut reports) = mpsc::unbounded_channel();
    let registry = RuntimeRegistry::<ContainerSender>::reporting_live_sessions(live_sessions);
    let runtime = ContainerMock::default();
    registry.attach(HarnessId::TEST_A, runtime.clone());
    runtime.sends_ready();

    let agent = runtime.agent();
    agent.wait_for_requests(1).await;
    agent.completes_initialize(
        agent_client_protocol::schema::v1::InitializeResponse::new(agent_session::PROTOCOL_VERSION)
            .agent_capabilities(
                agent_client_protocol::schema::v1::AgentCapabilities::new()
                    .load_session(true)
                    .session_capabilities(
                        agent_client_protocol::schema::v1::SessionCapabilities::new().list(
                            agent_client_protocol::schema::v1::SessionListCapabilities::new(),
                        ),
                    ),
            ),
    );
    agent.wait_for_requests(2).await;
    let Some(agent_client_protocol::RawJsonRpcMessage::Request(list)) =
        agent.received_frames().into_iter().nth(1)
    else {
        panic!("expected session/list after initialize");
    };
    assert_eq!(list.method.as_ref(), "session/list");
    agent.sends_reply(
        list.id,
        serde_json::json!({"sessions": [
            {"sessionId": "acp-1", "cwd": "/srv"},
            {"sessionId": "acp-2", "cwd": "/srv"},
        ]}),
    );

    let report = reports.recv().await.expect("the dial reports");
    assert_eq!(report.harness, HarnessId::TEST_A);
    assert_eq!(
        report
            .acp_sessions
            .into_iter()
            .map(|session| session.id)
            .collect::<Vec<_>>(),
        [SessionId::from("acp-1"), SessionId::from("acp-2")]
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn a_redial_closes_the_displaced_socket_while_a_session_still_holds_it() {
    use agent_runtime_protocol::domain::channel::Channel;
    use agent_runtime_protocol::outbound::websocket::ServerTransport;
    use futures::StreamExt;
    use tokio_tungstenite::tungstenite::Message;

    let transport: Arc<ServerTransport<ToRuntimeMessage, ToServerMessage>> =
        Arc::new(ServerTransport::new());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let app = Arc::clone(&transport).into_router();
    let server = tokio::spawn(async move { axum::serve(listener, app).await });
    let (mut displaced_runtime, _) = tokio_tungstenite::connect_async(format!("ws://{address}"))
        .await
        .expect("the runtime dials");
    let accepted = transport.accept().await.expect("the dial is accepted");

    let registry = RuntimeRegistry::new();
    registry.attach(HarnessId::TEST_A, accepted);
    let bound = connections(
        Arc::new(FakeBindings::bound(BotId::TEST_A, HarnessId::TEST_A)),
        &registry,
    );
    let _session = bound
        .bind(BotId::TEST_A, AgentSessionId::TEST_A)
        .await
        .expect("the first dial is bindable");

    let (redial, _redialed_runtime) = Channel::<ToRuntimeMessage, ToServerMessage>::duplex();
    registry.attach(HarnessId::TEST_A, redial);

    // The session still holds the displaced connection's sender, which used
    // to keep its socket open - and pinging - until the runtime next spoke.
    let closed = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            match displaced_runtime.next().await {
                Some(Ok(Message::Close(_)) | Err(_)) | None => break,
                Some(Ok(_)) => {}
            }
        }
    })
    .await;
    assert!(
        closed.is_ok(),
        "the displaced runtime should see its socket close so it knows to redial"
    );
    server.abort();
}

/// Presence that keeps rows the way the Postgres adapter does: a dial inserts
/// its row, a close deletes it, and a renewal upserts every row it lists.
/// Each renewal waits at `renewal_gate` after the registry has taken its
/// snapshot, so a test can close a connection in between.
#[derive(Default)]
struct LeasedPresence {
    rows: Mutex<Vec<RuntimeConnectionId>>,
    events: Mutex<Vec<PresenceEvent>>,
    renewal_started: tokio::sync::Notify,
    renewal_gate: tokio::sync::Notify,
    /// How many closes presence has recorded.
    disconnects: tokio::sync::watch::Sender<usize>,
}

impl LeasedPresence {
    fn rows(&self) -> Vec<RuntimeConnectionId> {
        self.rows.lock().unwrap().clone()
    }

    fn events(&self) -> Vec<PresenceEvent> {
        self.events.lock().unwrap().clone()
    }

    async fn recorded_disconnects(&self, count: usize) {
        let mut disconnects = self.disconnects.subscribe();
        tokio::time::timeout(
            Duration::from_secs(5),
            disconnects.wait_for(|recorded| *recorded >= count),
        )
        .await
        .unwrap_or_else(|_| {
            panic!(
                "presence never recorded {count} closes: {:?}",
                self.events()
            )
        })
        .expect("presence is alive");
    }
}

impl HarnessPresence for LeasedPresence {
    fn connected(
        self: Arc<Self>,
        _harness: HarnessId,
        connection: RuntimeConnectionId,
        _accepts: RuntimeAccepts,
    ) -> std::pin::Pin<Box<dyn Future<Output = ConnectionRecorded> + Send>> {
        Box::pin(async move {
            self.rows.lock().unwrap().push(connection);
            self.events
                .lock()
                .unwrap()
                .push(PresenceEvent::Connected(connection));
            ConnectionRecorded::AgentsUnchanged
        })
    }

    fn disconnected(
        self: Arc<Self>,
        _harness: HarnessId,
        connection: RuntimeConnectionId,
    ) -> std::pin::Pin<Box<dyn Future<Output = ()> + Send>> {
        Box::pin(async move {
            self.rows.lock().unwrap().retain(|row| *row != connection);
            self.events
                .lock()
                .unwrap()
                .push(PresenceEvent::Disconnected(connection));
            self.disconnects.send_modify(|recorded| *recorded += 1);
        })
    }

    fn renew(
        self: Arc<Self>,
        live: Vec<HarnessConnection>,
    ) -> std::pin::Pin<Box<dyn Future<Output = Vec<HarnessConnection>> + Send>> {
        Box::pin(async move {
            self.renewal_started.notify_one();
            self.renewal_gate.notified().await;
            let mut rows = self.rows.lock().unwrap();
            let mut restored = Vec::new();
            for (harness, connection) in live {
                if !rows.contains(&connection) {
                    rows.push(connection);
                    restored.push((harness, connection));
                }
            }
            restored
        })
    }
}

/// Lists a dial without `attach`, whose own watch would report its close
/// unprompted, and records it with presence.
async fn dial_recorded(
    registry: &Arc<RuntimeRegistry<ContainerSender>>,
    presence: &Arc<LeasedPresence>,
    runtime: &ContainerMock,
) -> ListedConnection<ContainerSender> {
    let listed = ListedConnection {
        id: RuntimeConnectionId::generate(),
        connection: RuntimeConnection::connect(runtime.clone()),
        accepts: RuntimeAccepts::default(),
    };
    registry
        .connections
        .insert(HarnessId::TEST_A, listed.clone());
    Arc::clone(presence)
        .connected(HarnessId::TEST_A, listed.id, listed.accepts)
        .await;
    listed
}

/// Start a renewal and return once it has taken its snapshot.
async fn renewal_holding_its_snapshot(
    registry: &Arc<RuntimeRegistry<ContainerSender>>,
    presence: &Arc<LeasedPresence>,
) -> JoinHandle<()> {
    let renewal = tokio::spawn({
        let registry = Arc::clone(registry);
        async move { registry.renew_presence().await }
    });
    presence.renewal_started.notified().await;
    renewal
}

/// A renewal that listed a connection before it closed must not leave that
/// connection's row standing after the close deleted it.
#[tokio::test]
async fn a_renewal_that_lands_after_a_close_leaves_the_connection_closed() {
    let presence = Arc::new(LeasedPresence::default());
    let registry = RuntimeRegistry::with_presence(
        Arc::clone(&presence) as Arc<dyn HarnessPresence>,
        mpsc::unbounded_channel().0,
    );
    let runtime = ContainerMock::default();
    let closing = dial_recorded(&registry, &presence, &runtime).await;

    let renewal = renewal_holding_its_snapshot(&registry, &presence).await;
    runtime.disconnects();
    Arc::clone(&registry)
        .drop_when_closed(HarnessId::TEST_A, closing.clone(), None)
        .await;
    assert!(presence.rows().is_empty());
    presence.renewal_gate.notify_one();
    renewal.await.expect("the renewal finishes");
    // The second close runs off the renewal's path.
    presence.recorded_disconnects(2).await;

    assert!(
        presence.rows().is_empty(),
        "the late renewal brought the closed connection back: {:?}",
        presence.rows()
    );
    assert_eq!(
        presence.events(),
        [
            PresenceEvent::Connected(closing.id),
            PresenceEvent::Disconnected(closing.id),
            PresenceEvent::Disconnected(closing.id),
        ]
    );
}

/// A harness that redials while a renewal is in flight keeps its new
/// connection: only the closed one is cleaned up.
#[tokio::test]
async fn a_redial_during_a_late_renewal_stays_connected() {
    let presence = Arc::new(LeasedPresence::default());
    let registry = RuntimeRegistry::with_presence(
        Arc::clone(&presence) as Arc<dyn HarnessPresence>,
        mpsc::unbounded_channel().0,
    );
    let first = ContainerMock::default();
    let closing = dial_recorded(&registry, &presence, &first).await;

    let renewal = renewal_holding_its_snapshot(&registry, &presence).await;
    first.disconnects();
    Arc::clone(&registry)
        .drop_when_closed(HarnessId::TEST_A, closing.clone(), None)
        .await;
    let redial = dial_recorded(&registry, &presence, &ContainerMock::default()).await;
    presence.renewal_gate.notify_one();
    renewal.await.expect("the renewal finishes");
    presence.recorded_disconnects(2).await;

    assert_eq!(presence.rows(), [redial.id]);
    assert!(registry.is_connected(HarnessId::TEST_A));
    assert_eq!(
        presence.events(),
        [
            PresenceEvent::Connected(closing.id),
            PresenceEvent::Disconnected(closing.id),
            PresenceEvent::Connected(redial.id),
            PresenceEvent::Disconnected(closing.id),
        ]
    );
}

/// A close still waiting on its own attach write when a late renewal
/// restores its row: the renewal's close runs first, and the attach write
/// then the close's own leave it closed.
#[tokio::test(start_paused = true)]
async fn a_late_renewal_during_a_close_that_waits_for_its_attach_ends_closed() {
    let presence = Arc::new(LeasedPresence::default());
    let registry = RuntimeRegistry::with_presence(
        Arc::clone(&presence) as Arc<dyn HarnessPresence>,
        mpsc::unbounded_channel().0,
    );
    let runtime = ContainerMock::default();
    let listed = ListedConnection {
        id: RuntimeConnectionId::generate(),
        connection: RuntimeConnection::connect(runtime.clone()),
        accepts: RuntimeAccepts::default(),
    };
    registry
        .connections
        .insert(HarnessId::TEST_A, listed.clone());
    let (release, released) = tokio::sync::oneshot::channel::<()>();
    let connected_write = tokio::spawn({
        let presence = Arc::clone(&presence);
        let listed = listed.clone();
        async move {
            let _ = released.await;
            presence
                .connected(HarnessId::TEST_A, listed.id, listed.accepts)
                .await;
        }
    });

    let renewal = renewal_holding_its_snapshot(&registry, &presence).await;
    runtime.disconnects();
    let closing = Arc::clone(&registry).drop_when_closed(
        HarnessId::TEST_A,
        listed.clone(),
        Some(connected_write),
    );
    tokio::pin!(closing);
    tokio::select! {
        () = &mut closing => panic!("the close finished before its attach was recorded"),
        () = tokio::time::sleep(Duration::from_secs(1)) => {}
    }
    assert!(!registry.is_connected(HarnessId::TEST_A));
    presence.renewal_gate.notify_one();
    renewal.await.expect("the renewal finishes");
    presence.recorded_disconnects(1).await;
    release.send(()).expect("the attach write is waiting");
    closing.await;

    assert!(presence.rows().is_empty(), "{:?}", presence.rows());
    assert_eq!(
        presence.events(),
        [
            PresenceEvent::Disconnected(listed.id),
            PresenceEvent::Connected(listed.id),
            PresenceEvent::Disconnected(listed.id),
        ]
    );
}

/// A renewal that restores the row of a connection this process still holds
/// (its attach write failed, or its lapsed row was reaped) keeps it.
#[tokio::test]
async fn a_renewal_restores_a_held_connections_missing_row() {
    let presence = Arc::new(LeasedPresence::default());
    let registry = RuntimeRegistry::with_presence(
        Arc::clone(&presence) as Arc<dyn HarnessPresence>,
        mpsc::unbounded_channel().0,
    );
    let held = dial_recorded(&registry, &presence, &ContainerMock::default()).await;
    presence.rows.lock().unwrap().clear();

    let renewal = renewal_holding_its_snapshot(&registry, &presence).await;
    presence.renewal_gate.notify_one();
    renewal.await.expect("the renewal finishes");

    assert_eq!(presence.rows(), [held.id]);
    assert_eq!(presence.events(), [PresenceEvent::Connected(held.id)]);
}

fn teammate_install() -> agent_runtime_protocol::domain::schema::v0::TeammateInstall {
    agent_runtime_protocol::domain::schema::v0::TeammateInstall {
        install_id: agent_runtime_protocol::domain::schema::v0::TeammateInstallId::new("i-1")
            .unwrap(),
        generation: 1,
        delivery: 1,
    }
}

fn teammate_image() -> agent_runtime_protocol::domain::schema::v0::TeammateImage {
    agent_runtime_protocol::domain::schema::v0::TeammateImage {
        repository: "ghcr.io/macro-inc/teammate-runtime".to_owned(),
        image_id: format!("sha256:{}", "a".repeat(64)),
    }
}

#[tokio::test]
async fn a_teammate_install_goes_only_to_the_dial_it_was_issued_for_on_a_runtime_that_hosts_them() {
    let registry = RuntimeRegistry::new();
    let runtime = ContainerMock::default();
    registry.attach_accepting(
        HarnessId::TEST_A,
        runtime.clone(),
        RuntimeAccepts {
            teammate_container: true,
            ..RuntimeAccepts::default()
        },
    );
    let dial = registry.connection_of(HarnessId::TEST_A).unwrap();
    let environment = || {
        agent_runtime_protocol::domain::schema::v0::AgentEnvironment(
            [("MACRO_API_KEY".to_owned(), "mak_x".to_owned())].into(),
        )
    };

    // Issued for an earlier dial: a redial may report another generation.
    let stale = registry
        .run_teammate(
            HarnessId::TEST_A,
            RuntimeConnectionId::generate(),
            teammate_install(),
            teammate_image(),
            environment(),
            None,
        )
        .await;
    let sent = registry
        .run_teammate(
            HarnessId::TEST_A,
            dial,
            teammate_install(),
            teammate_image(),
            environment(),
            None,
        )
        .await;

    assert!(!stale);
    assert!(sent);
    let runs = runtime
        .sent()
        .into_iter()
        .filter(|message| matches!(message, ToRuntimeMessage::RunTeammate { .. }))
        .count();
    assert_eq!(runs, 1);
}

#[tokio::test]
async fn a_runtime_that_hosts_no_teammates_is_never_sent_one() {
    let registry = RuntimeRegistry::new();
    let runtime = ContainerMock::default();
    registry.attach(HarnessId::TEST_A, runtime.clone());
    let dial = registry.connection_of(HarnessId::TEST_A).unwrap();

    let sent = registry
        .stop_teammate(HarnessId::TEST_A, dial, teammate_install(), None)
        .await;

    assert!(!sent);
    assert!(
        !runtime
            .sent()
            .iter()
            .any(|message| matches!(message, ToRuntimeMessage::StopTeammate { .. }))
    );
}

#[tokio::test]
async fn a_recheck_goes_only_to_a_runtime_that_listed_it() {
    let registry = RuntimeRegistry::new();
    let listing = ContainerMock::default();
    registry.attach_accepting(
        HarnessId::TEST_A,
        listing.clone(),
        RuntimeAccepts {
            recheck_teammate_host: true,
            ..RuntimeAccepts::default()
        },
    );
    let older = ContainerMock::default();
    registry.attach_accepting(
        HarnessId::TEST_B,
        older.clone(),
        RuntimeAccepts {
            teammate_container: true,
            ..RuntimeAccepts::default()
        },
    );

    assert!(registry.recheck_teammate_host(HarnessId::TEST_A).await);
    assert!(!registry.recheck_teammate_host(HarnessId::TEST_B).await);
    assert!(
        !registry
            .recheck_teammate_host(HarnessId::new_from_uuid(uuid::Uuid::now_v7()))
            .await
    );

    assert!(matches!(
        listing.sent().as_slice(),
        [ToRuntimeMessage::RecheckTeammateHost]
    ));
    assert!(
        !older
            .sent()
            .iter()
            .any(|message| matches!(message, ToRuntimeMessage::RecheckTeammateHost)),
        "{:?}",
        older.sent()
    );
}
