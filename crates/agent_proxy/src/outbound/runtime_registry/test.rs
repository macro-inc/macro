use super::*;
use futures::StreamExt;

fn session() -> Uuid {
    Uuid::from_u128(0x1111_2222_3333_4444)
}

fn message() -> RawJsonRpcMessage {
    RawJsonRpcMessage::notification("session/update".to_string(), serde_json::json!({}))
        .expect("valid notification")
}

#[tokio::test]
async fn send_routes_to_registered_session() {
    let registry = SessionRegistry::new();
    let (tx, mut rx) = futures::channel::mpsc::unbounded();
    registry.register(session(), 1, tx).unwrap();

    assert!(registry.is_connected(session()));
    registry.send(session(), message()).unwrap();
    assert!(matches!(
        rx.next().await,
        Some(Ok(RawJsonRpcMessage::Notification(_)))
    ));
}

#[tokio::test]
async fn send_to_unknown_session_fails() {
    let registry = SessionRegistry::new();
    assert!(!registry.is_connected(session()));
    assert!(matches!(
        registry.send(session(), message()),
        Err(AgentProxyErr::SessionNotConnected)
    ));
}

#[tokio::test]
async fn stale_registration_cannot_unregister_replacement() {
    let registry = SessionRegistry::new();
    let (old_tx, _old_rx) = futures::channel::mpsc::unbounded();
    let old = registry.register(session(), 1, old_tx).unwrap();

    // The agent restarted on the same connection: a new registration at the
    // same epoch replaces the old one.
    let (new_tx, mut new_rx) = futures::channel::mpsc::unbounded();
    let _new = registry.register(session(), 1, new_tx).unwrap();

    // The old registration's cleanup must not remove the new one.
    registry.unregister(session(), old);
    assert!(registry.is_connected(session()));

    registry.send(session(), message()).unwrap();
    assert!(new_rx.next().await.is_some());
}

#[tokio::test]
async fn stale_epoch_cannot_displace_newer_connection() {
    let registry = SessionRegistry::new();

    // A newer connection (epoch 2) owns the session.
    let (new_tx, mut new_rx) = futures::channel::mpsc::unbounded();
    let _new = registry.register(session(), 2, new_tx).unwrap();

    // A half-dead older connection (epoch 1) attaches late: rejected.
    let (old_tx, _old_rx) = futures::channel::mpsc::unbounded();
    assert!(registry.register(session(), 1, old_tx).is_none());

    registry.send(session(), message()).unwrap();
    assert!(new_rx.next().await.is_some());
}

#[tokio::test]
async fn newer_epoch_replaces_older_connection() {
    let registry = SessionRegistry::new();
    let (old_tx, _old_rx) = futures::channel::mpsc::unbounded();
    let old = registry.register(session(), 1, old_tx).unwrap();

    let (new_tx, mut new_rx) = futures::channel::mpsc::unbounded();
    let _new = registry.register(session(), 2, new_tx).unwrap();

    // The dead connection's teardown is a no-op against the replacement.
    registry.unregister(session(), old);
    assert!(registry.is_connected(session()));
    registry.send(session(), message()).unwrap();
    assert!(new_rx.next().await.is_some());
}

#[tokio::test]
async fn unregister_removes_current_registration() {
    let registry = SessionRegistry::new();
    let (tx, _rx) = futures::channel::mpsc::unbounded();
    let registration = registry.register(session(), 1, tx).unwrap();

    registry.unregister(session(), registration);
    assert!(!registry.is_connected(session()));
}
