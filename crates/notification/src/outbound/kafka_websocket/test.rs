use std::sync::{Arc, Mutex};

use macro_event_broker::{
    EventBrokerError, EventPublisher, MacroEvent, MacroEventBrokerService, Spawner,
};
use macro_event_topics::Topic;
use serde::ser::Error as _;

use super::*;
use crate::domain::models::websocket_notification_event::{
    NotificationMacroEvent, NotificationTopicEvent, WebSocketNotificationMetadata,
};

#[derive(Debug)]
struct PublishedRecord {
    topic: String,
    key: String,
    payload: Vec<u8>,
}

struct RecordingPublisher {
    records: Arc<Mutex<Vec<PublishedRecord>>>,
    fail: bool,
}

impl EventPublisher for RecordingPublisher {
    async fn publish<T: Topic>(&self, key: &str, payload: &[u8]) -> Result<(), EventBrokerError> {
        self.records
            .lock()
            .expect("records lock")
            .push(PublishedRecord {
                topic: T::TOPIC_STR.to_string(),
                key: key.to_string(),
                payload: payload.to_vec(),
            });

        if self.fail {
            Err(EventBrokerError::Publish("broker unavailable".to_string()))
        } else {
            Ok(())
        }
    }
}

#[derive(Clone, Copy)]
struct TokioSpawner;

impl Spawner for TokioSpawner {
    fn spawn<F>(&self, future: F) -> tokio::task::JoinHandle<F::Output>
    where
        F: Future + Send + 'static,
        F::Output: Send + 'static,
    {
        tokio::spawn(future)
    }
}

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(id.to_string()).expect("valid user id")
}

#[tokio::test]
async fn publishes_one_event_per_call_with_all_recipients() {
    let records = Arc::new(Mutex::new(Vec::new()));
    let sender = KafkaWebSocketSender::new(MacroEventBrokerService::new(
        RecordingPublisher {
            records: records.clone(),
            fail: false,
        },
        TokioSpawner,
    ));
    let recipients = [
        user("macro|first@example.com"),
        user("macro|second@example.com"),
    ];
    let notification = serde_json::json!({
        "notification_id": "01952f4d-6890-7df2-8598-89d4e18c07db",
        "notification_event_type": "channel_mention",
    });

    let delivered = sender
        .send_notifications(&recipients, &notification)
        .await
        .expect("publish succeeds");

    assert!(delivered.is_empty());
    let records = records.lock().expect("records lock");
    assert_eq!(records.len(), 1);

    let record = &records[0];
    assert_eq!(record.topic, "macro.notifications");
    let expected_metadata = WebSocketNotificationMetadata {
        recipients: recipients.to_vec(),
        notification: notification.clone(),
    };

    let payload: serde_json::Value =
        serde_json::from_slice(&record.payload).expect("payload is valid JSON");
    assert_eq!(
        record.key,
        payload["event_id"].as_str().expect("event id is a string")
    );
    assert_eq!(payload["schema_version"], 1);
    assert_eq!(
        payload["event_type"],
        "notification.websocket_delivery_requested"
    );
    assert_eq!(
        payload["metadata"]["recipients"],
        serde_json::json!(["macro|first@example.com", "macro|second@example.com"])
    );
    assert_eq!(payload["metadata"]["notification"], notification);

    let decoded = NotificationMacroEvent::decode(record.key.clone(), &record.payload)
        .expect("event round-trips");
    assert_eq!(
        decoded.event().event,
        NotificationTopicEvent::WebSocketDeliveryRequested(expected_metadata)
    );
}

#[tokio::test]
async fn empty_recipients_still_publishes_one_event() {
    let records = Arc::new(Mutex::new(Vec::new()));
    let sender = KafkaWebSocketSender::new(MacroEventBrokerService::new(
        RecordingPublisher {
            records: records.clone(),
            fail: false,
        },
        TokioSpawner,
    ));

    sender
        .send_notifications(&[], &serde_json::json!({ "kind": "test" }))
        .await
        .expect("publish succeeds");

    let records = records.lock().expect("records lock");
    assert_eq!(records.len(), 1);
    let payload: serde_json::Value =
        serde_json::from_slice(&records[0].payload).expect("payload is valid JSON");
    assert_eq!(payload["metadata"]["recipients"], serde_json::json!([]));
}

#[tokio::test]
async fn propagates_publish_failures() {
    let sender = KafkaWebSocketSender::new(MacroEventBrokerService::new(
        RecordingPublisher {
            records: Arc::new(Mutex::new(Vec::new())),
            fail: true,
        },
        TokioSpawner,
    ));

    sender
        .send_notifications(
            &[user("macro|recipient@example.com")],
            &serde_json::json!({ "kind": "test" }),
        )
        .await
        .expect_err("publish failure propagates");
}

struct SerializationFailure;

impl Serialize for SerializationFailure {
    fn serialize<S>(&self, _serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        Err(S::Error::custom("serialization failed"))
    }
}

#[tokio::test]
async fn propagates_serialization_failures_without_publishing() {
    let records = Arc::new(Mutex::new(Vec::new()));
    let sender = KafkaWebSocketSender::new(MacroEventBrokerService::new(
        RecordingPublisher {
            records: records.clone(),
            fail: false,
        },
        TokioSpawner,
    ));

    sender
        .send_notifications(
            &[user("macro|recipient@example.com")],
            &SerializationFailure,
        )
        .await
        .expect_err("serialization failure propagates");

    assert!(records.lock().expect("records lock").is_empty());
}
