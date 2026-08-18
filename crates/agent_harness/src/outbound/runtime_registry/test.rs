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
