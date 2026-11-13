//! Binding rules of the registry: what a session finds when it looks for its
//! bot's runtime - resolved through the bot's harness binding - and what a
//! redial does to whatever was there.

use std::collections::HashMap;
use std::future::Future;
use std::sync::Mutex;

use super::*;
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
    ) -> anyhow::Result<Vec<AgentSessionId>> {
        Ok(Vec::new())
    }
}

fn connections(
    bindings: Arc<FakeBindings>,
    registry: &Arc<RuntimeRegistry<ContainerSender>>,
) -> HarnessKeyedConnections<Arc<FakeBindings>, ContainerSender> {
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
    events: Mutex<Vec<PresenceEvent>>,
    renewed: Mutex<Vec<Vec<(HarnessId, RuntimeConnectionId)>>>,
}

impl HarnessPresence for RecordingPresence {
    fn connected(
        self: Arc<Self>,
        _harness: HarnessId,
        connection: RuntimeConnectionId,
    ) -> std::pin::Pin<Box<dyn Future<Output = ()> + Send>> {
        Box::pin(async move {
            self.events
                .lock()
                .unwrap()
                .push(PresenceEvent::Connected(connection));
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
        live: Vec<(HarnessId, RuntimeConnectionId)>,
    ) -> std::pin::Pin<Box<dyn Future<Output = ()> + Send>> {
        Box::pin(async move {
            self.renewed.lock().unwrap().push(live);
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

#[tokio::test]
async fn a_disconnect_unlists_the_connection_and_ends_it() {
    let registry = RuntimeRegistry::<ContainerSender>::new();
    registry.attach(HarnessId::TEST_A, ContainerMock::default());
    let dropped = listed_connection(&registry);

    assert!(registry.disconnect(HarnessId::TEST_A));

    assert!(!registry.is_connected(HarnessId::TEST_A));
    // Its socket's end is what makes the runtime dial again.
    dropped.connection.closed().await;
    // Nothing is left to drop.
    assert!(!registry.disconnect(HarnessId::TEST_A));
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
