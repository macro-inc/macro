use agent_runtime_protocol::domain::schema::v0::{SystemEvent, ToServerMessage};
use agent_session::domain::model::Message;
use macro_event_broker::{
    EventBrokerError, MacroEventCollection as _, MessageParts, MessageWrapper,
};

use super::DeclaredMacroEvent;

struct TestMessage {
    payload: Vec<u8>,
}

impl MessageParts for TestMessage {
    fn key(&self) -> Option<&str> {
        Some("0000000a-0000-0000-0000-000000000000")
    }

    fn payload(&self) -> Option<&[u8]> {
        Some(&self.payload)
    }

    fn topic(&self) -> &str {
        "macro.agent_session_log"
    }
}

#[test]
fn assigns_only_the_log_topic() {
    assert_eq!(DeclaredMacroEvent::topics(), ["macro.agent_session_log"]);
}

#[test]
fn decodes_an_appended_run() {
    let content = serde_json::to_value(Message::ToServer(ToServerMessage::Event {
        event: SystemEvent::AcpReady,
    }))
    .expect("serializable");
    let message = MessageWrapper::<_, DeclaredMacroEvent>::new(TestMessage {
        payload: serde_json::to_vec(&serde_json::json!({
            "event_id": "00000000-0000-0000-0000-000000000001",
            "schema_version": 1,
            "event_type": "agent_session_log.appended",
            "metadata": {
                "agent_session_id": "0000000a-0000-0000-0000-000000000000",
                "entries": [{
                    "id": "00000000-0000-0000-0000-000000000001",
                    "created_at": "2026-08-13T12:34:56.789Z",
                    "user_id": null,
                    "content": content
                }]
            }
        }))
        .expect("serializable"),
    });

    let DeclaredMacroEvent::AgentSessionLogMacroEvent(event) =
        message.decode_payload().expect("decodes");
    let super::AgentSessionLogTopicEvent::Appended(appended) = event.into_payload();
    let rows = appended.into_stored();
    assert_eq!(rows.len(), 1);
    assert_eq!(
        rows[0].entry.agent_session_id.to_string(),
        "0000000a-0000-0000-0000-000000000000"
    );
}

#[test]
fn rejects_unsupported_schema_versions() {
    let message = MessageWrapper::<_, DeclaredMacroEvent>::new(TestMessage {
        payload: serde_json::to_vec(&serde_json::json!({
            "event_id": "00000000-0000-0000-0000-000000000001",
            "schema_version": 2,
            "event_type": "agent_session_log.appended",
            "metadata": { "agent_session_id": "0000000a-0000-0000-0000-000000000000", "entries": [] }
        }))
        .expect("serializable"),
    });

    assert!(matches!(
        message.decode_payload(),
        Err(EventBrokerError::UnsupportedSchemaVersion { .. })
    ));
}
