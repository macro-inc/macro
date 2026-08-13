use std::sync::{Arc, Mutex};

use macro_event_broker::{
    EventBrokerError, EventPublisher, MacroEvent, MacroEventBrokerService, Spawner,
};
use macro_event_topics::Topic;
use macro_user_id::user_id::MacroUserIdStr;

use super::*;
use crate::domain::models::websocket_notification_event::NotificationTopicEvent;
use crate::domain::models::{NotificationStatusUpdate, PatchDelete};

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
    MacroUserIdStr::try_from(id.to_string()).expect("valid user ID")
}

fn update(
    user: MacroUserIdStr<'static>,
    notification_id: uuid::Uuid,
) -> UserNotificationStatusUpdate<'static> {
    UserNotificationStatusUpdate {
        user,
        update: NotificationStatusUpdate::new(vec![PatchDelete::Delete {
            id: notification_id,
        }]),
    }
}

#[tokio::test]
async fn publishes_one_event_per_call_for_one_user() {
    let records = Arc::new(Mutex::new(Vec::new()));
    let publisher = KafkaNotificationRealtimePublisher::new(MacroEventBrokerService::new(
        RecordingPublisher {
            records: Arc::clone(&records),
            fail: false,
        },
        TokioSpawner,
    ));
    let recipient = user("macro|recipient@example.com");
    let first_id = uuid::Uuid::parse_str("0193b1ea-c742-7589-893b-2b4a509c1e77")
        .expect("valid notification ID");
    let second_id = uuid::Uuid::parse_str("0193b1ea-c742-7589-893b-2b4a509c1e78")
        .expect("valid notification ID");
    let updates = [
        update(recipient.clone(), first_id),
        update(recipient.clone(), second_id),
    ];

    publisher
        .publish_updates(&updates)
        .await
        .expect("publish succeeds");

    let records = records.lock().expect("records lock");
    assert_eq!(records.len(), 1);

    let record = &records[0];
    assert_eq!(record.topic, "macro.notifications");
    let payload: serde_json::Value =
        serde_json::from_slice(&record.payload).expect("payload is valid JSON");
    assert_eq!(record.key, recipient.as_ref());
    assert_eq!(payload["schema_version"], 1);
    assert_eq!(payload["event_type"], "notification.status_updated");
    assert_eq!(payload["metadata"]["user"], recipient.as_ref());
    assert_eq!(payload["metadata"]["updates"].as_array().unwrap().len(), 2);

    let decoded =
        NotificationMacroEvent::<serde_json::Value>::decode(record.key.clone(), &record.payload)
            .expect("event round-trips");
    let NotificationTopicEvent::NotificationStatusUpdated { user, updates } =
        decoded.into_topic_event()
    else {
        panic!("expected notification status update event");
    };
    assert_eq!(user.as_ref(), recipient.as_ref());
    assert_eq!(updates.len(), 2);
    assert_eq!(
        serde_json::to_value(updates).unwrap(),
        payload["metadata"]["updates"]
    );
}

#[tokio::test]
async fn rejects_updates_for_multiple_users_without_publishing() {
    let records = Arc::new(Mutex::new(Vec::new()));
    let publisher = KafkaNotificationRealtimePublisher::new(MacroEventBrokerService::new(
        RecordingPublisher {
            records: Arc::clone(&records),
            fail: false,
        },
        TokioSpawner,
    ));
    let updates = [
        update(user("macro|first@example.com"), uuid::Uuid::nil()),
        update(user("macro|second@example.com"), uuid::Uuid::nil()),
    ];

    publisher
        .publish_updates(&updates)
        .await
        .expect_err("mixed-user update batch is rejected");

    assert!(records.lock().expect("records lock").is_empty());
}

#[tokio::test]
async fn empty_updates_do_not_publish_events() {
    let records = Arc::new(Mutex::new(Vec::new()));
    let publisher = KafkaNotificationRealtimePublisher::new(MacroEventBrokerService::new(
        RecordingPublisher {
            records: Arc::clone(&records),
            fail: false,
        },
        TokioSpawner,
    ));

    publisher
        .publish_updates(&[])
        .await
        .expect("empty update list succeeds");

    assert!(records.lock().expect("records lock").is_empty());
}

#[tokio::test]
async fn propagates_publish_failures() {
    let publisher = KafkaNotificationRealtimePublisher::new(MacroEventBrokerService::new(
        RecordingPublisher {
            records: Arc::new(Mutex::new(Vec::new())),
            fail: true,
        },
        TokioSpawner,
    ));

    publisher
        .publish_updates(&[update(
            user("macro|recipient@example.com"),
            uuid::Uuid::nil(),
        )])
        .await
        .expect_err("publish failure propagates");
}
