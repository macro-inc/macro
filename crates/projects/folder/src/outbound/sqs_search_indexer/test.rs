use std::sync::{Arc, Mutex};

use macro_event_broker::{EventBrokerError, MacroEvent, MacroEventBroker};
use serde_json::{Value, json};
use uuid::Uuid;

use super::*;

#[derive(Clone, Debug, PartialEq)]
struct PublishedEvent {
    topic: String,
    key: String,
    envelope: Value,
}

#[derive(Clone, Default)]
struct RecordingEventBroker {
    state: Arc<Mutex<RecordingState>>,
    fail_send: bool,
}

#[derive(Default)]
struct RecordingState {
    attempts: usize,
    published: Vec<PublishedEvent>,
}

impl RecordingEventBroker {
    fn failing() -> Self {
        Self {
            fail_send: true,
            ..Self::default()
        }
    }

    fn attempts(&self) -> usize {
        self.state.lock().unwrap().attempts
    }

    fn published(&self) -> Vec<PublishedEvent> {
        self.state.lock().unwrap().published.clone()
    }
}

impl MacroEventBroker for RecordingEventBroker {
    fn send_event<E: MacroEvent + ?Sized>(
        &self,
        event: &E,
    ) -> Result<tokio::task::JoinHandle<Result<(), EventBrokerError>>, EventBrokerError> {
        let mut state = self.state.lock().unwrap();
        state.attempts += 1;

        if self.fail_send {
            return Err(EventBrokerError::Publish(
                "event enqueue rejected".to_string(),
            ));
        }

        state.published.push(PublishedEvent {
            topic: event.topic().to_string(),
            key: event.key().to_string(),
            envelope: serde_json::to_value(event.event())?,
        });

        Ok(tokio::spawn(async { Ok(()) }))
    }
}

fn test_sqs_client() -> Arc<sqs_client::SQS> {
    let config = aws_sdk_sqs::Config::builder()
        .behavior_version(aws_sdk_sqs::config::BehaviorVersion::latest())
        .build();

    Arc::new(sqs_client::SQS::new(aws_sdk_sqs::Client::from_conf(config)))
}

#[tokio::test]
async fn empty_document_list_publishes_no_events() {
    let event_broker = RecordingEventBroker::default();
    let indexer = SqsProjectSearchIndexer::new(test_sqs_client(), event_broker.clone());

    indexer.remove_documents(Vec::new()).await.unwrap();

    assert_eq!(event_broker.attempts(), 0);
    assert!(event_broker.published().is_empty());
}

#[tokio::test]
async fn document_removals_publish_separately_keyed_purged_event_envelopes() {
    let event_broker = RecordingEventBroker::default();
    let indexer = SqsProjectSearchIndexer::new(test_sqs_client(), event_broker.clone());
    let document_ids = vec!["document-one".to_string(), "document-two".to_string()];

    indexer
        .remove_documents(document_ids.clone())
        .await
        .unwrap();

    let published = event_broker.published();
    assert_eq!(published.len(), document_ids.len());

    for (event, document_id) in published.iter().zip(document_ids) {
        assert_eq!(event.topic, "macro.documents");
        assert_eq!(event.key, document_id);

        let event_id = event.envelope["event_id"].clone();
        assert!(Uuid::parse_str(event_id.as_str().unwrap()).is_ok());
        assert_eq!(
            event.envelope,
            json!({
                "event_id": event_id,
                "schema_version": 1,
                "event_type": "document.purged",
                "metadata": {
                    "document_id": document_id,
                },
            })
        );
    }
}

#[tokio::test]
async fn document_removals_return_immediate_broker_failures() {
    let event_broker = RecordingEventBroker::failing();
    let indexer = SqsProjectSearchIndexer::new(test_sqs_client(), event_broker.clone());

    let error = indexer
        .remove_documents(vec!["document-one".to_string()])
        .await
        .expect_err("immediate broker failure should be returned");

    assert!(format!("{error:#}").contains("event enqueue rejected"));
    assert_eq!(event_broker.attempts(), 1);
    assert!(event_broker.published().is_empty());
}
