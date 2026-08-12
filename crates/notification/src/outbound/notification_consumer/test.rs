use macro_event_broker::{EventBrokerError, MacroEventCollection as _, MessageParts};
use serde::{Deserialize, Serialize};

use super::{DeclaredMacroEvent, validate_notification_schema};

#[derive(Debug, Serialize, Deserialize)]
struct TestNotification {
    kind: String,
}

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
    assert_eq!(
        DeclaredMacroEvent::<TestNotification>::topics(),
        ["macro.notifications"]
    );
}

#[test]
fn classifies_unsupported_schema_versions_before_decoding_payload_metadata() {
    let message = TestMessage {
        payload: serde_json::to_vec(&serde_json::json!({
            "event_id": "00000000-0000-0000-0000-000000000001",
            "schema_version": 2,
            "event_type": "notification.websocket_delivery_requested",
            "metadata": {}
        }))
        .expect("serializable event"),
    };

    assert!(matches!(
        validate_notification_schema(&message),
        Err(EventBrokerError::UnsupportedSchemaVersion {
            expected: 1,
            actual: 2,
            ..
        })
    ));
}
