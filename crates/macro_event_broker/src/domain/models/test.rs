use macro_event_topics::{MacroDocumentsTopic, MacroExampleTopic, Topic};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use super::*;
use crate::MessageParts;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExampleCreatedMetadata {
    name: String,
    count: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "event_type", content = "metadata")]
pub enum ExampleTopicEvent {
    #[serde(rename = "example.created")]
    Created(ExampleCreatedMetadata),
}

impl TopicEvent for ExampleTopicEvent {
    type Topic = MacroExampleTopic;

    fn schema_version(&self) -> u8 {
        1
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExampleMacroEvent {
    key: String,
    event: Event<ExampleTopicEvent>,
}

impl ExampleMacroEvent {
    fn with_event(key: impl Into<String>, event: Event<ExampleTopicEvent>) -> Self {
        Self {
            key: key.into(),
            event,
        }
    }
}

impl MacroEvent for ExampleMacroEvent {
    type EventPayload = ExampleTopicEvent;

    fn key(&self) -> &str {
        &self.key
    }

    fn event(&self) -> &Event<Self::EventPayload> {
        &self.event
    }

    fn from_event(key: String, event: Event<Self::EventPayload>) -> Self {
        Self::with_event(key, event)
    }
}

enum ExampleConsumerEvent {
    Example(ExampleMacroEvent),
}

impl ExampleConsumerEvent {
    fn decode(topic: &str, key: &str, payload: &[u8]) -> Result<Self, EventBrokerError> {
        match topic {
            topic if topic == MacroExampleTopic.as_str() => {
                Ok(Self::Example(ExampleMacroEvent::decode(key, payload)?))
            }
            unknown => Err(EventBrokerError::UnknownTopic(unknown.to_string())),
        }
    }
}

fn example_event() -> Event<ExampleTopicEvent> {
    Event::with_event_id(
        Uuid::from_u128(1),
        ExampleTopicEvent::Created(ExampleCreatedMetadata {
            name: "hello".to_string(),
            count: 7,
        }),
    )
}

#[test]
fn event_serializes_to_tagged_wire_shape() {
    let event = example_event();

    assert_eq!(
        serde_json::to_value(&event).unwrap(),
        json!({
            "event_id": "00000000-0000-0000-0000-000000000001",
            "schema_version": 1,
            "event_type": "example.created",
            "metadata": {
                "name": "hello",
                "count": 7,
            },
        })
    );
}

#[test]
fn macro_event_decodes_from_payload() {
    let event = example_event();
    let payload = serde_json::to_vec(&event).unwrap();

    let decoded = ExampleMacroEvent::decode("msg-123", &payload).unwrap();

    assert_eq!(decoded.key(), "msg-123");
    assert_eq!(decoded.event(), &event);
}

#[test]
fn consumer_specific_enum_decodes_by_topic() {
    let event = example_event();
    let payload = serde_json::to_vec(&event).unwrap();

    let decoded = ExampleConsumerEvent::decode(MacroExampleTopic.as_str(), "msg-123", &payload)
        .expect("topic should decode");

    let ExampleConsumerEvent::Example(decoded) = decoded;
    assert_eq!(decoded.key(), "msg-123");
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DocumentsTopicEvent;

impl TopicEvent for DocumentsTopicEvent {
    type Topic = MacroDocumentsTopic;

    fn schema_version(&self) -> u8 {
        1
    }
}

pub struct DocumentsMacroEvent {
    key: String,
    event: Event<DocumentsTopicEvent>,
}

impl MacroEvent for DocumentsMacroEvent {
    type EventPayload = DocumentsTopicEvent;

    fn key(&self) -> &str {
        &self.key
    }

    fn event(&self) -> &Event<Self::EventPayload> {
        &self.event
    }

    fn from_event(key: String, event: Event<Self::EventPayload>) -> Self {
        Self { key, event }
    }
}

crate::declare_topics!(ExampleMacroEvent, DocumentsMacroEvent,);

struct TestMessage {
    topic: &'static str,
    key: &'static str,
    payload: Vec<u8>,
}

impl MessageParts for TestMessage {
    fn key(&self) -> &str {
        self.key
    }

    fn payload(&self) -> &[u8] {
        &self.payload
    }

    fn topic(&self) -> &str {
        self.topic
    }
}

#[test]
fn decodes_each_declared_topic_into_its_enum_variant() {
    let example_payload = serde_json::to_vec(&example_event()).unwrap();
    let example_message = MessageWrapper::<_, DeclaredMacroEvent>::new(TestMessage {
        topic: MacroExampleTopic.as_str(),
        key: "example-key",
        payload: example_payload,
    });

    match example_message.decode_payload().unwrap() {
        DeclaredMacroEvent::ExampleMacroEvent(event) => {
            assert_eq!(event.key(), "example-key");
        }
        DeclaredMacroEvent::DocumentsMacroEvent(_) => panic!("decoded the wrong event type"),
    }

    let documents_payload = serde_json::to_vec(&Event::new(DocumentsTopicEvent)).unwrap();
    let documents_message = MessageWrapper::<_, DeclaredMacroEvent>::new(TestMessage {
        topic: MacroDocumentsTopic.as_str(),
        key: "documents-key",
        payload: documents_payload,
    });

    match documents_message.decode_payload().unwrap() {
        DeclaredMacroEvent::DocumentsMacroEvent(event) => {
            assert_eq!(event.key(), "documents-key");
        }
        DeclaredMacroEvent::ExampleMacroEvent(_) => panic!("decoded the wrong event type"),
    }
}

#[test]
fn rejects_topics_not_declared_by_the_macro() {
    let message = MessageWrapper::<_, DeclaredMacroEvent>::new(TestMessage {
        topic: "macro.unknown",
        key: "key",
        payload: Vec::new(),
    });

    assert!(matches!(
        message.decode_payload(),
        Err(EventBrokerError::UnknownTopic(topic)) if topic == "macro.unknown"
    ));
}
