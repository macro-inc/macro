use std::sync::Mutex;

use macro_event_broker::{EventBrokerError, MacroEvent, MacroEventBroker};
use serde_json::{Value, json};
use uuid::Uuid;

use super::*;

#[derive(Debug, PartialEq)]
struct PublishedEvent {
    topic: String,
    key: String,
    envelope: Value,
}

#[derive(Default)]
struct RecordingEventBroker {
    published: Mutex<Vec<PublishedEvent>>,
}

impl MacroEventBroker for RecordingEventBroker {
    fn send_event<E: MacroEvent + ?Sized>(
        &self,
        event: &E,
    ) -> Result<tokio::task::JoinHandle<Result<(), EventBrokerError>>, EventBrokerError> {
        self.published.lock().unwrap().push(PublishedEvent {
            topic: event.topic().to_owned(),
            key: event.key().to_owned(),
            envelope: serde_json::to_value(event.event())?,
        });

        Ok(tokio::spawn(async { Ok(()) }))
    }
}

struct FailingEventBroker;

impl MacroEventBroker for FailingEventBroker {
    fn send_event<E: MacroEvent + ?Sized>(
        &self,
        _event: &E,
    ) -> Result<tokio::task::JoinHandle<Result<(), EventBrokerError>>, EventBrokerError> {
        Err(EventBrokerError::Publish(
            "event enqueue rejected".to_string(),
        ))
    }
}

#[tokio::test]
async fn publishes_document_purged_event_to_documents_topic() {
    let event_broker = RecordingEventBroker::default();

    publish_document_purged_event(&event_broker, "document-one").unwrap();

    let published = event_broker.published.lock().unwrap();
    assert_eq!(published.len(), 1);

    let event = &published[0];
    assert_eq!(event.topic, "macro.documents");
    assert_eq!(event.key, "document-one");
    assert!(Uuid::parse_str(event.envelope["event_id"].as_str().unwrap()).is_ok());
    assert_eq!(event.envelope["schema_version"], json!(1));
    assert_eq!(event.envelope["event_type"], json!("document.purged"));
    assert_eq!(
        event.envelope["metadata"],
        json!({ "document_id": "document-one" })
    );
}

#[test]
fn returns_immediate_broker_failures() {
    let error = publish_document_purged_event(&FailingEventBroker, "document-one")
        .expect_err("immediate broker failure should be returned");

    assert!(matches!(
        error,
        EventBrokerError::Publish(message) if message == "event enqueue rejected"
    ));
}
