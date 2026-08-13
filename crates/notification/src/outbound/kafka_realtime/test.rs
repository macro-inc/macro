use std::sync::{Arc, Mutex};

use chrono::Utc;
use macro_event_broker::{
    EventBrokerError, EventPublisher, MacroEvent, MacroEventBrokerService, Spawner,
};
use macro_event_topics::Topic;
use model_entity::EntityType;
use serde::ser::Error as _;
use uuid::Uuid;

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

fn notification() -> RealtimeNotif<serde_json::Value> {
    RealtimeNotif {
        notification_id: Uuid::parse_str("01952f4d-6890-7df2-8598-89d4e18c07db")
            .expect("valid notification ID"),
        notification_event_type: "channel_mention".to_string(),
        entity: EntityType::Channel.with_entity_string("channel-id".to_string()),
        sent: true,
        done: false,
        created_at: Utc::now(),
        viewed_at: None,
        updated_at: Utc::now(),
        deleted_at: None,
        notification_metadata: serde_json::json!({
            "tag": "channel_mention",
            "content": { "message": "test" }
        }),
        sender_id: None,
    }
}

#[tokio::test]
async fn publishes_one_event_per_call_with_all_recipients() {
    let records = Arc::new(Mutex::new(Vec::new()));
    let sender = KafkaRealtimeSender::new(MacroEventBrokerService::new(
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
    let notification = notification();

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
        notifications: recipients
            .iter()
            .cloned()
            .map(|recipient| user_notification_row(recipient, &notification))
            .collect(),
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
        payload["metadata"]["notifications"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert_eq!(
        payload["metadata"]["notifications"][0]["owner_id"],
        "macro|first@example.com"
    );
    assert_eq!(
        payload["metadata"]["notifications"][1]["owner_id"],
        "macro|second@example.com"
    );

    let decoded = NotificationMacroEvent::decode(record.key.clone(), &record.payload)
        .expect("event round-trips");
    let NotificationTopicEvent::WebSocketDeliveryRequested(actual_metadata) =
        decoded.into_topic_event()
    else {
        panic!("expected WebSocket delivery event");
    };
    assert_eq!(actual_metadata, expected_metadata);
}

#[tokio::test]
async fn empty_recipients_still_publishes_one_event() {
    let records = Arc::new(Mutex::new(Vec::new()));
    let sender = KafkaRealtimeSender::new(MacroEventBrokerService::new(
        RecordingPublisher {
            records: records.clone(),
            fail: false,
        },
        TokioSpawner,
    ));

    sender
        .send_notifications(&[], &notification())
        .await
        .expect("publish succeeds");

    let records = records.lock().expect("records lock");
    assert_eq!(records.len(), 1);
    let payload: serde_json::Value =
        serde_json::from_slice(&records[0].payload).expect("payload is valid JSON");
    assert_eq!(payload["metadata"]["notifications"], serde_json::json!([]));
}

#[tokio::test]
async fn propagates_publish_failures() {
    let sender = KafkaRealtimeSender::new(MacroEventBrokerService::new(
        RecordingPublisher {
            records: Arc::new(Mutex::new(Vec::new())),
            fail: true,
        },
        TokioSpawner,
    ));

    sender
        .send_notifications(&[user("macro|recipient@example.com")], &notification())
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
    let sender = KafkaRealtimeSender::new(MacroEventBrokerService::new(
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
