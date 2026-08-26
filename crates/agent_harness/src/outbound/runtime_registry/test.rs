//! Binding rules of the registry: what a session finds when it looks for its
//! bot's runtime, and what a redial does to whatever was there.

use super::*;
use crate::testing::helpers::containers::{ContainerMock, ContainerSender};

#[tokio::test]
async fn a_bot_with_no_runtime_has_nothing_to_bind_to() {
    let registry = RuntimeRegistry::<ContainerSender>::new();

    assert!(!registry.is_connected(BotId::TEST_A));
    assert!(
        registry
            .bind(BotId::TEST_A, AgentSessionId::TEST_A)
            .await
            .is_none()
    );
}

#[tokio::test]
async fn a_session_binds_onto_its_bots_connection() {
    let registry = RuntimeRegistry::new();
    registry.attach(BotId::TEST_A, ContainerMock::default());

    assert!(registry.is_connected(BotId::TEST_A));
    assert!(
        registry
            .bind(BotId::TEST_A, AgentSessionId::TEST_A)
            .await
            .is_some()
    );
    // A connection belongs to one bot only.
    assert!(
        registry
            .bind(BotId::TEST_B, AgentSessionId::TEST_A)
            .await
            .is_none()
    );
}

#[tokio::test]
async fn a_redial_displaces_the_previous_connection() {
    let registry = RuntimeRegistry::new();
    registry.attach(BotId::TEST_A, ContainerMock::default());
    registry
        .bind(BotId::TEST_A, AgentSessionId::TEST_A)
        .await
        .expect("the first dial is bindable");

    registry.attach(BotId::TEST_A, ContainerMock::default());

    // Displacing leaves the bot connected, and the session that was riding on
    // the old connection binds again onto the new one - which is how a
    // reconnect restores it.
    assert!(registry.is_connected(BotId::TEST_A));
    assert!(
        registry
            .bind(BotId::TEST_A, AgentSessionId::TEST_A)
            .await
            .is_some()
    );
}

#[tokio::test]
async fn a_closed_connection_is_unlisted_so_nothing_binds_onto_it() {
    let registry = RuntimeRegistry::new();
    let runtime = ContainerMock::default();
    registry.attach(BotId::TEST_A, runtime.clone());
    let connection = registry
        .connections
        .get(&BotId::TEST_A)
        .map(|entry| Arc::clone(&entry))
        .expect("the dial is listed");

    runtime.disconnects();
    // The same work `attach` spawns, awaited here rather than raced.
    Arc::clone(&registry)
        .drop_when_closed(BotId::TEST_A, connection)
        .await;

    assert!(!registry.is_connected(BotId::TEST_A));
    assert!(
        registry
            .bind(BotId::TEST_A, AgentSessionId::TEST_A)
            .await
            .is_none()
    );
}

#[tokio::test]
async fn a_redials_connection_outlives_the_one_it_displaced() {
    let registry = RuntimeRegistry::new();
    let first = ContainerMock::default();
    registry.attach(BotId::TEST_A, first.clone());
    let displaced = registry
        .connections
        .get(&BotId::TEST_A)
        .map(|entry| Arc::clone(&entry))
        .expect("the first dial is listed");

    registry.attach(BotId::TEST_A, ContainerMock::default());
    first.disconnects();
    Arc::clone(&registry)
        .drop_when_closed(BotId::TEST_A, displaced)
        .await;

    // The dead connection's eviction must not unlist the live one that took
    // its place, or a redial would leave the bot unreachable.
    assert!(registry.is_connected(BotId::TEST_A));
    assert!(
        registry
            .bind(BotId::TEST_A, AgentSessionId::TEST_A)
            .await
            .is_some()
    );
}

#[tokio::test]
async fn one_connection_carries_many_sessions() {
    let registry = RuntimeRegistry::new();
    registry.attach(BotId::TEST_A, ContainerMock::default());

    assert!(
        registry
            .bind(BotId::TEST_A, AgentSessionId::TEST_A)
            .await
            .is_some()
    );
    assert!(
        registry
            .bind(BotId::TEST_A, AgentSessionId::TEST_B)
            .await
            .is_some()
    );
}
