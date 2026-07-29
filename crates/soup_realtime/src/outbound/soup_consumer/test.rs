use macro_event_broker::{EventBrokerError, MacroEventCollection as _, MessageParts};

use super::{DeclaredMacroEvent, validate_soup_schema};

struct TestMessage {
    payload: Vec<u8>,
}

impl MessageParts for TestMessage {
    fn key(&self) -> Option<&str> {
        Some("macro|user@example.com")
    }

    fn payload(&self) -> Option<&[u8]> {
        Some(&self.payload)
    }

    fn topic(&self) -> &str {
        "macro.soup"
    }
}

#[test]
fn assigns_only_the_typed_soup_topic() {
    assert_eq!(DeclaredMacroEvent::topics(), ["macro.soup"]);
}

#[test]
fn classifies_v1_soup_events_as_unsupported_before_decoding_the_old_payload() {
    let message = TestMessage {
        payload: serde_json::to_vec(&serde_json::json!({
            "event_id": "00000000-0000-0000-0000-000000000001",
            "schema_version": 1,
            "event_type": "soup.item.updated",
            "metadata": {}
        }))
        .expect("serializable event"),
    };

    assert!(matches!(
        validate_soup_schema(&message),
        Err(EventBrokerError::UnsupportedSchemaVersion {
            expected: 2,
            actual: 1,
            ..
        })
    ));
}
