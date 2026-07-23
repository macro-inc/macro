use macro_event_topics::{MacroDocumentsTopic, MacroExampleTopic, Topic};
use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use super::*;
use crate::{MacroEventCollection, MessageParts};

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
            topic if topic == MacroExampleTopic::TOPIC_STR => {
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

    let decoded = ExampleConsumerEvent::decode(MacroExampleTopic::TOPIC_STR, "msg-123", &payload)
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

crate::declare_topics!(TestMacroEvents: ExampleMacroEvent, DocumentsMacroEvent,);

type DeclaredMacroEvent = TestMacroEvents;

struct TestMessage {
    topic: &'static str,
    key: Option<&'static str>,
    payload: Option<Vec<u8>>,
}

impl MessageParts for TestMessage {
    fn key(&self) -> Option<&str> {
        self.key
    }

    fn payload(&self) -> Option<&[u8]> {
        self.payload.as_deref()
    }

    fn topic(&self) -> &str {
        self.topic
    }
}

#[test]
fn exposes_each_declared_topic_in_order() {
    assert_eq!(
        DeclaredMacroEvent::topics(),
        [MacroExampleTopic::TOPIC_STR, MacroDocumentsTopic::TOPIC_STR,]
    );
}

#[test]
fn decodes_each_declared_topic_into_its_enum_variant() {
    let example_payload = serde_json::to_vec(&example_event()).unwrap();
    let example_message = MessageWrapper::<_, DeclaredMacroEvent>::new(TestMessage {
        topic: MacroExampleTopic::TOPIC_STR,
        key: Some("example-key"),
        payload: Some(example_payload),
    });

    match example_message.decode_payload().unwrap() {
        DeclaredMacroEvent::ExampleMacroEvent(event) => {
            assert_eq!(event.key(), "example-key");
        }
        DeclaredMacroEvent::DocumentsMacroEvent(_) => panic!("decoded the wrong event type"),
    }

    let documents_payload = serde_json::to_vec(&Event::new(DocumentsTopicEvent)).unwrap();
    let documents_message = MessageWrapper::<_, DeclaredMacroEvent>::new(TestMessage {
        topic: MacroDocumentsTopic::TOPIC_STR,
        key: Some("documents-key"),
        payload: Some(documents_payload),
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
        key: None,
        payload: None,
    });

    assert!(matches!(
        message.decode_payload(),
        Err(EventBrokerError::UnknownTopic(topic)) if topic == "macro.unknown"
    ));
}

#[test]
fn rejects_a_missing_message_key() {
    let message = MessageWrapper::<_, DeclaredMacroEvent>::new(TestMessage {
        topic: MacroExampleTopic::TOPIC_STR,
        key: None,
        payload: Some(serde_json::to_vec(&example_event()).unwrap()),
    });

    assert!(matches!(
        message.decode_payload(),
        Err(EventBrokerError::MissingMessageKey)
    ));
}

#[test]
fn rejects_a_missing_message_payload() {
    let message = MessageWrapper::<_, DeclaredMacroEvent>::new(TestMessage {
        topic: MacroExampleTopic::TOPIC_STR,
        key: Some("example-key"),
        payload: None,
    });

    assert!(matches!(
        message.decode_payload(),
        Err(EventBrokerError::MissingMessagePayload)
    ));
}

#[test]
fn rejects_an_unsupported_schema_version() {
    let event = Event::with_event_id_and_schema_version(
        Uuid::from_u128(1),
        2,
        ExampleTopicEvent::Created(ExampleCreatedMetadata {
            name: "hello".to_string(),
            count: 7,
        }),
    );
    let message = MessageWrapper::<_, DeclaredMacroEvent>::new(TestMessage {
        topic: MacroExampleTopic::TOPIC_STR,
        key: Some("example-key"),
        payload: Some(serde_json::to_vec(&event).unwrap()),
    });

    assert!(matches!(
        message.decode_payload(),
        Err(EventBrokerError::UnsupportedSchemaVersion {
            topic,
            expected: 1,
            actual: 2,
        }) if topic == MacroExampleTopic::TOPIC_STR
    ));
}
