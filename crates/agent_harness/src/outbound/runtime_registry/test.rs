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
        .map(|entry| Arc::clone(&entry))
        .expect("the dial is listed");
    let bound = connections(
        Arc::new(FakeBindings::bound(BotId::TEST_A, HarnessId::TEST_A)),
        &registry,
    );

    runtime.disconnects();
    // The same work `attach` spawns, awaited here rather than raced.
    Arc::clone(&registry)
        .drop_when_closed(HarnessId::TEST_A, connection)
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
        .map(|entry| Arc::clone(&entry))
        .expect("the first dial is listed");
    let bound = connections(
        Arc::new(FakeBindings::bound(BotId::TEST_A, HarnessId::TEST_A)),
        &registry,
    );

    registry.attach(HarnessId::TEST_A, ContainerMock::default());
    first.disconnects();
    Arc::clone(&registry)
        .drop_when_closed(HarnessId::TEST_A, displaced)
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

#[tokio::test]
async fn attach_and_close_report_presence() {
    #[derive(Default)]
    struct RecordingPresence {
        events: Mutex<Vec<(HarnessId, &'static str)>>,
    }

    impl HarnessPresence for RecordingPresence {
        fn connected(
            self: Arc<Self>,
            harness: HarnessId,
        ) -> std::pin::Pin<Box<dyn Future<Output = ()> + Send>> {
            Box::pin(async move {
                self.events.lock().unwrap().push((harness, "connected"));
            })
        }

        fn disconnected(
            self: Arc<Self>,
            harness: HarnessId,
        ) -> std::pin::Pin<Box<dyn Future<Output = ()> + Send>> {
            Box::pin(async move {
                self.events.lock().unwrap().push((harness, "disconnected"));
            })
        }
    }

    let presence = Arc::new(RecordingPresence::default());
    let registry: Arc<RuntimeRegistry<ContainerSender>> =
        RuntimeRegistry::with_presence(Arc::clone(&presence) as Arc<dyn HarnessPresence>);
    let runtime = ContainerMock::default();
    registry.attach(HarnessId::TEST_A, runtime.clone());
    let connection = registry
        .connections
        .get(&HarnessId::TEST_A)
        .map(|entry| Arc::clone(&entry))
        .expect("the dial is listed");

    runtime.disconnects();
    Arc::clone(&registry)
        .drop_when_closed(HarnessId::TEST_A, connection)
        .await;

    // The connected write is spawned; give it a beat to land.
    for _ in 0..100 {
        if presence.events.lock().unwrap().len() >= 2 {
            break;
        }
        tokio::task::yield_now().await;
    }
    let events = presence.events.lock().unwrap().clone();
    assert!(events.contains(&(HarnessId::TEST_A, "connected")));
    assert!(events.contains(&(HarnessId::TEST_A, "disconnected")));
}
