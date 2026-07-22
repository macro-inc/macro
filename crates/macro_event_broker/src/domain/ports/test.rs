use macro_event_topics::{MacroDocumentsTopic, MacroExampleTopic};
use serde::{Deserialize, Serialize};

use super::{MessageParts, MessageWrapper};
use crate::{Event, EventBrokerError, MacroEvent, Topic, TopicEvent};

#[derive(Debug, Serialize, Deserialize)]
struct ExampleTopicEvent;

impl TopicEvent for ExampleTopicEvent {
    type Topic = MacroExampleTopic;

    fn schema_version(&self) -> u8 {
        1
    }
}

struct ExampleMacroEvent {
    key: String,
    event: Event<ExampleTopicEvent>,
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
        Self { key, event }
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct DocumentsTopicEvent;

impl TopicEvent for DocumentsTopicEvent {
    type Topic = MacroDocumentsTopic;

    fn schema_version(&self) -> u8 {
        1
    }
}

struct DocumentsMacroEvent {
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
    let example_payload = serde_json::to_vec(&Event::new(ExampleTopicEvent)).unwrap();
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
