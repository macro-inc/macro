//! Binding rules of the registry: what a session finds when it looks for its
//! bot's runtime - resolved through the bot's harness binding - and what a
//! redial does to whatever was there.

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
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

#[derive(Clone)]
struct FakeLease {
    owner: crate::domain::model::RuntimeOwner,
    releases: Arc<Mutex<Vec<macro_uuid::Uuid>>>,
}

impl RuntimeLease for FakeLease {
    fn claim(
        &self,
        _harness: HarnessId,
        _replica: agent_session::domain::model::ReplicaId,
        _connection_id: macro_uuid::Uuid,
    ) -> Pin<Box<dyn Future<Output = anyhow::Result<bool>> + Send>> {
        Box::pin(async { Ok(true) })
    }

    fn activate(
        &self,
        _harness: HarnessId,
        _replica: agent_session::domain::model::ReplicaId,
        _connection_id: macro_uuid::Uuid,
    ) -> Pin<Box<dyn Future<Output = anyhow::Result<bool>> + Send>> {
        Box::pin(async { Ok(true) })
    }

    fn release(
        &self,
        _harness: HarnessId,
        _replica: agent_session::domain::model::ReplicaId,
        connection_id: macro_uuid::Uuid,
    ) -> Pin<Box<dyn Future<Output = anyhow::Result<()>> + Send>> {
        let releases = Arc::clone(&self.releases);
        Box::pin(async move {
            releases.lock().unwrap().push(connection_id);
            Ok(())
        })
    }

    fn owner(
        &self,
        _harness: HarnessId,
    ) -> Pin<
        Box<dyn Future<Output = anyhow::Result<Option<crate::domain::model::RuntimeOwner>>> + Send>,
    > {
        let owner = self.owner.clone();
        Box::pin(async move { Ok(Some(owner)) })
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
        .map(|entry| (entry.0, Arc::clone(&entry.1)))
        .expect("the dial is listed");
    let bound = connections(
        Arc::new(FakeBindings::bound(BotId::TEST_A, HarnessId::TEST_A)),
        &registry,
    );

    runtime.disconnects();
    // The same work `attach` spawns, awaited here rather than raced.
    Arc::clone(&registry)
        .drop_when_closed(HarnessId::TEST_A, connection.0, connection.1)
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
        .map(|entry| (entry.0, Arc::clone(&entry.1)))
        .expect("the first dial is listed");
    let bound = connections(
        Arc::new(FakeBindings::bound(BotId::TEST_A, HarnessId::TEST_A)),
        &registry,
    );

    registry.attach(HarnessId::TEST_A, ContainerMock::default());
    first.disconnects();
    Arc::clone(&registry)
        .drop_when_closed(HarnessId::TEST_A, displaced.0, displaced.1)
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
async fn a_stale_close_cannot_remove_a_newer_token() {
    let replica = agent_session::domain::model::ReplicaId::mint();
    let releases = Arc::new(Mutex::new(Vec::new()));
    let lease = FakeLease {
        owner: crate::domain::model::RuntimeOwner {
            replica,
            connection_id: macro_uuid::Uuid::new_v4(),
            pending_until: None,
            address: None,
        },
        releases: Arc::clone(&releases),
    };
    let registry = RuntimeRegistry::with_lease(replica, Arc::new(lease));
    let first = ContainerMock::default();
    let first_id = macro_uuid::Uuid::new_v4();
    registry.attach_with_id(HarnessId::TEST_A, first_id, first.clone());
    let first_connection = registry
        .connections
        .get(&HarnessId::TEST_A)
        .map(|entry| Arc::clone(&entry.1))
        .expect("the first dial is listed");

    registry.remove_and_evict(HarnessId::TEST_A, first_id);
    let second_id = macro_uuid::Uuid::new_v4();
    registry.attach_with_id(HarnessId::TEST_A, second_id, ContainerMock::default());
    first.disconnects();
    Arc::clone(&registry)
        .drop_when_closed(HarnessId::TEST_A, first_id, first_connection)
        .await;

    assert!(registry.is_connected(HarnessId::TEST_A));
    assert!(
        releases.lock().unwrap().is_empty(),
        "a stale close must not release either token"
    );
}

#[tokio::test]
async fn an_expired_pending_owner_does_not_start_a_fresh_wait() {
    let replica = agent_session::domain::model::ReplicaId::mint();
    let lease = FakeLease {
        owner: crate::domain::model::RuntimeOwner {
            replica,
            connection_id: macro_uuid::Uuid::new_v4(),
            pending_until: Some(chrono::Utc::now() - chrono::Duration::milliseconds(1)),
            address: None,
        },
        releases: Arc::default(),
    };
    let registry = RuntimeRegistry::<ContainerSender>::with_lease(replica, Arc::new(lease.clone()));
    let connections = HarnessKeyedConnections::with_lease(
        Arc::new(FakeBindings::bound(BotId::TEST_A, HarnessId::TEST_A)),
        lease,
        registry,
    );

    assert!(
        tokio::time::timeout(
            Duration::from_millis(5),
            connections.bind(BotId::TEST_A, AgentSessionId::TEST_A),
        )
        .await
        .expect("an expired deadline returns immediately")
        .is_none()
    );
}

#[tokio::test]
async fn a_pending_local_owner_waits_only_a_bounded_time_for_its_exact_socket() {
    let replica = agent_session::domain::model::ReplicaId::mint();
    let connection_id = macro_uuid::Uuid::new_v4();
    let lease = FakeLease {
        owner: crate::domain::model::RuntimeOwner {
            replica,
            connection_id,
            pending_until: Some(chrono::Utc::now() + chrono::Duration::milliseconds(25)),
            address: None,
        },
        releases: Arc::default(),
    };
    let registry = RuntimeRegistry::<ContainerSender>::with_lease(replica, Arc::new(lease.clone()));
    let connections = HarnessKeyedConnections::with_lease(
        Arc::new(FakeBindings::bound(BotId::TEST_A, HarnessId::TEST_A)),
        lease,
        registry,
    );

    assert!(
        tokio::time::timeout(
            Duration::from_millis(100),
            connections.bind(BotId::TEST_A, AgentSessionId::TEST_A),
        )
        .await
        .expect("pending attach wait is bounded")
        .is_none()
    );
}

#[tokio::test]
async fn a_pending_local_owner_wakes_when_its_exact_socket_attaches() {
    let replica = agent_session::domain::model::ReplicaId::mint();
    let connection_id = macro_uuid::Uuid::new_v4();
    let lease = FakeLease {
        owner: crate::domain::model::RuntimeOwner {
            replica,
            connection_id,
            pending_until: Some(chrono::Utc::now() + chrono::Duration::milliseconds(25)),
            address: None,
        },
        releases: Arc::default(),
    };
    let registry = RuntimeRegistry::<ContainerSender>::with_lease(replica, Arc::new(lease.clone()));
    let connections = HarnessKeyedConnections::with_lease(
        Arc::new(FakeBindings::bound(BotId::TEST_A, HarnessId::TEST_A)),
        lease,
        Arc::clone(&registry),
    );

    let binding = connections.bind(BotId::TEST_A, AgentSessionId::TEST_A);
    let attach = async {
        tokio::task::yield_now().await;
        registry.attach_with_id(HarnessId::TEST_A, connection_id, ContainerMock::default());
    };
    let (bound, ()) = tokio::join!(binding, attach);
    assert!(bound.is_some());
}

#[tokio::test]
async fn ownership_requires_the_exact_local_connection_token() {
    let replica = agent_session::domain::model::ReplicaId::mint();
    let local_token = macro_uuid::Uuid::new_v4();
    let lease = FakeLease {
        owner: crate::domain::model::RuntimeOwner {
            replica,
            connection_id: local_token,
            pending_until: None,
            address: None,
        },
        releases: Arc::default(),
    };
    let registry = RuntimeRegistry::with_lease(replica, Arc::new(lease));
    registry.attach_with_id(HarnessId::TEST_A, local_token, ContainerMock::default());

    assert!(registry.owns(
        HarnessId::TEST_A,
        &crate::domain::model::RuntimeOwner {
            replica,
            connection_id: local_token,
            pending_until: None,
            address: None,
        }
    ));
    assert!(!registry.owns(
        HarnessId::TEST_A,
        &crate::domain::model::RuntimeOwner {
            replica,
            connection_id: macro_uuid::Uuid::new_v4(),
            pending_until: None,
            address: None,
        }
    ));
}

#[tokio::test]
async fn close_releases_only_the_closed_connections_exact_token() {
    let replica = agent_session::domain::model::ReplicaId::mint();
    let connection_id = macro_uuid::Uuid::new_v4();
    let releases = Arc::new(Mutex::new(Vec::new()));
    let lease = FakeLease {
        owner: crate::domain::model::RuntimeOwner {
            replica,
            connection_id,
            pending_until: None,
            address: None,
        },
        releases: Arc::clone(&releases),
    };
    let registry = RuntimeRegistry::with_lease(replica, Arc::new(lease));
    let runtime = ContainerMock::default();
    registry.attach_with_id(HarnessId::TEST_A, connection_id, runtime.clone());
    let connection = registry
        .connections
        .get(&HarnessId::TEST_A)
        .map(|entry| Arc::clone(&entry.1))
        .unwrap();

    runtime.disconnects();
    Arc::clone(&registry)
        .drop_when_closed(HarnessId::TEST_A, connection_id, connection)
        .await;
    for _ in 0..10 {
        if !releases.lock().unwrap().is_empty() {
            break;
        }
        tokio::task::yield_now().await;
    }

    assert_eq!(*releases.lock().unwrap(), vec![connection_id]);
}
