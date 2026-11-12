use super::*;

#[test]
fn producer_bounds_payloads_and_scopes_default_deduplication_to_kind_and_subject() {
    let session = AgentSessionId::new();
    let input = ProduceNotification {
        session_id: session,
        subject_id: "connection-1".into(),
        event: NotificationEvent::AppConnected {
            app: "Calendar".into(),
        },
        dedupe_key: None,
        wake: true,
    };
    let first = PendingNotification::new(input.clone()).unwrap();
    let second = PendingNotification::new(input.clone()).unwrap();
    assert_eq!(first.dedupe_key, "app.connected:connection-1");
    assert_eq!(first.dedupe_key, second.dedupe_key);
    assert_ne!(first.notification.id, second.notification.id);
    let mut oversized = input.clone();
    oversized.subject_id = "x".repeat(513);
    assert!(PendingNotification::new(oversized).is_err());
    let mut oversized = input;
    oversized.event = NotificationEvent::AppConnected {
        app: "x".repeat(65536),
    };
    assert!(PendingNotification::new(oversized).is_err());
}
