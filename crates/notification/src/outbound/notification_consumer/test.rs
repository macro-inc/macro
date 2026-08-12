use macro_event_broker::{
    EventBrokerError, MacroEventCollection as _, MessageParts, MessageWrapper,
};

use super::DeclaredMacroEvent;

struct TestMessage {
    payload: Vec<u8>,
}

impl MessageParts for TestMessage {
    fn key(&self) -> Option<&str> {
        Some("00000000-0000-0000-0000-000000000001")
    }

    fn payload(&self) -> Option<&[u8]> {
        Some(&self.payload)
    }

    fn topic(&self) -> &str {
        "macro.notifications"
    }
}

#[test]
fn assigns_only_the_typed_notifications_topic() {
    assert_eq!(DeclaredMacroEvent::topics(), ["macro.notifications"]);
}

#[test]
fn declared_topic_decoder_rejects_unsupported_schema_versions() {
    let message = MessageWrapper::<_, DeclaredMacroEvent>::new(TestMessage {
        payload: serde_json::to_vec(&serde_json::json!({
            "event_id": "00000000-0000-0000-0000-000000000001",
            "schema_version": 2,
            "event_type": "notification.websocket_delivery_requested",
            "metadata": {
                "recipients": [],
                "notification": {}
            }
        }))
        .expect("serializable event"),
    });

    assert!(matches!(
        message.decode_payload(),
        Err(EventBrokerError::UnsupportedSchemaVersion {
            expected: 1,
            actual: 2,
            ..
        })
    ));
}
