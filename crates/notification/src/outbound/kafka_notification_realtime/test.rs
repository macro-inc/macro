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
async fn publishes_one_typed_event_per_user_scoped_update() {
    let records = Arc::new(Mutex::new(Vec::new()));
    let publisher = KafkaNotificationRealtimePublisher::new(MacroEventBrokerService::new(
        RecordingPublisher {
            records: Arc::clone(&records),
            fail: false,
        },
        TokioSpawner,
    ));
    let first_user = user("macro|first@example.com");
    let second_user = user("macro|second@example.com");
    let first_id = uuid::Uuid::parse_str("0193b1ea-c742-7589-893b-2b4a509c1e77")
        .expect("valid notification ID");
    let second_id = uuid::Uuid::parse_str("0193b1ea-c742-7589-893b-2b4a509c1e78")
        .expect("valid notification ID");
    let updates = [
        update(first_user.clone(), first_id),
        update(second_user.clone(), second_id),
    ];

    publisher
        .publish_updates(&updates)
        .await
        .expect("publishes succeed");

    let mut records = records.lock().expect("records lock");
    records.sort_by(|left, right| left.key.cmp(&right.key));
    assert_eq!(records.len(), 2);

    for (record, expected_user) in records.iter().zip([first_user, second_user]) {
        assert_eq!(record.topic, "macro.notifications");
        assert_eq!(record.key, expected_user.as_ref());

        let payload: serde_json::Value =
            serde_json::from_slice(&record.payload).expect("payload is valid JSON");
        assert_eq!(payload["schema_version"], 1);
        assert_eq!(payload["event_type"], "notification.status_updated");
        assert_eq!(payload["metadata"]["user"], expected_user.as_ref());
        assert_eq!(payload["metadata"]["updates"].as_array().unwrap().len(), 1);

        let decoded = NotificationMacroEvent::<serde_json::Value>::decode(
            record.key.clone(),
            &record.payload,
        )
        .expect("event round-trips");
        let NotificationTopicEvent::NotificationStatusUpdated { user, updates } =
            decoded.into_topic_event()
        else {
            panic!("expected notification status update event");
        };
        assert_eq!(user.as_ref(), expected_user.as_ref());
        assert_eq!(updates.len(), 1);
        assert_eq!(
            serde_json::to_value(updates).unwrap(),
            payload["metadata"]["updates"]
        );
    }
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
