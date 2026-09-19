use std::borrow::Cow;
use std::sync::{Arc, Mutex};

use chrono::Utc;
use macro_event_broker::{
    EventBrokerError, EventPublisher, MacroEvent, MacroEventBrokerService, Spawner,
};
use macro_event_topics::Topic;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;

use super::*;
use crate::domain::models::websocket_notification_event::NotificationTopicEvent;
use crate::domain::models::{NotificationDelete, UserNotificationRow};

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

fn row(
    owner_id: MacroUserIdStr<'static>,
    notification_id: uuid::Uuid,
) -> UserNotificationRow<serde_json::Value> {
    UserNotificationRow {
        owner_id,
        notification_id,
        notification_event_type: "test".to_string(),
        entity: EntityType::Document.with_entity_string("document-id".to_string()),
        sent: true,
        done: false,
        created_at: Utc::now(),
        viewed_at: None,
        updated_at: Utc::now(),
        deleted_at: None,
        notification_metadata: serde_json::json!({ "kind": "test" }),
        sender_id: None,
    }
}

fn publisher(
    records: Arc<Mutex<Vec<PublishedRecord>>>,
    fail: bool,
) -> KafkaNotificationRealtimePublisher<MacroEventBrokerService<RecordingPublisher, TokioSpawner>> {
    KafkaNotificationRealtimePublisher::new(MacroEventBrokerService::new(
        RecordingPublisher { records, fail },
        TokioSpawner,
    ))
}

fn assert_envelope(record: &PublishedRecord, event_type: &str) -> serde_json::Value {
    assert_eq!(record.topic, "macro.notifications");
    let payload: serde_json::Value =
        serde_json::from_slice(&record.payload).expect("payload is valid JSON");
    assert_eq!(
        record.key,
        payload["event_id"].as_str().expect("event ID is a string")
    );
    assert_eq!(payload["schema_version"], 1);
    assert_eq!(payload["event_type"], event_type);
    payload
}

#[tokio::test]
async fn publishes_one_notification_for_many_users_event() {
    let records = Arc::new(Mutex::new(Vec::new()));
    let publisher = publisher(Arc::clone(&records), false);
    let first_user = user("macro|first@example.com");
    let second_user = user("macro|second@example.com");
    let notification_id = uuid::Uuid::parse_str("0193b1ea-c742-7589-893b-2b4a509c1e77")
        .expect("valid notification ID");
    let payload = NotificationStatusPayload::NotificationForUsers {
        users: vec![first_user.clone(), second_user.clone()],
        update: Box::new(NotificationDelete::Delete {
            id: notification_id,
        }),
    };

    publisher
        .publish_updates(&payload)
        .await
        .expect("publish succeeds");

    let records = records.lock().expect("records lock");
    assert_eq!(records.len(), 1);
    let record = &records[0];
    let payload = assert_envelope(record, "notification.status_updated_for_users");
    assert_eq!(
        payload["metadata"]["users"],
        serde_json::json!([first_user.as_ref(), second_user.as_ref()])
    );

    let decoded =
        NotificationMacroEvent::<serde_json::Value>::decode(record.key.clone(), &record.payload)
            .expect("event round-trips");
    let NotificationTopicEvent::NotificationStatusUpdatedForUsers { users, update } =
        decoded.into_topic_event()
    else {
        panic!("expected notification status update for users event");
    };
    assert_eq!(users, vec![first_user, second_user]);
    assert_eq!(
        *update,
        NotificationDelete::Delete {
            id: notification_id,
        }
    );
}

#[tokio::test]
async fn publishes_many_notifications_for_one_user_event() {
    let records = Arc::new(Mutex::new(Vec::new()));
    let publisher = publisher(Arc::clone(&records), false);
    let recipient = user("macro|recipient@example.com");
    let first_id = uuid::Uuid::parse_str("0193b1ea-c742-7589-893b-2b4a509c1e77")
        .expect("valid notification ID");
    let second_id = uuid::Uuid::parse_str("0193b1ea-c742-7589-893b-2b4a509c1e78")
        .expect("valid notification ID");
    let first_row = row(recipient.clone(), first_id);
    let payload = NotificationStatusPayload::UserNotifications {
        user: recipient.clone(),
        updates: vec![
            PatchDelete::Patch {
                diff: Cow::Borrowed(&first_row),
            },
            PatchDelete::Delete { id: second_id },
        ],
    };

    publisher
        .publish_updates(&payload)
        .await
        .expect("publish succeeds");

    let records = records.lock().expect("records lock");
    assert_eq!(records.len(), 1);
    let record = &records[0];
    let payload = assert_envelope(record, "notification.statuses_updated_for_user");
    assert_eq!(payload["metadata"]["user"], recipient.as_ref());
    assert_eq!(payload["metadata"]["updates"].as_array().unwrap().len(), 2);

    let decoded =
        NotificationMacroEvent::<serde_json::Value>::decode(record.key.clone(), &record.payload)
            .expect("event round-trips");
    let NotificationTopicEvent::NotificationStatusesUpdatedForUser { user, updates } =
        decoded.into_topic_event()
    else {
        panic!("expected notification statuses update for user event");
    };
    assert_eq!(user, recipient);
    assert_eq!(
        updates,
        vec![
            PatchDelete::Patch {
                diff: Cow::Owned(first_row),
            },
            PatchDelete::Delete { id: second_id },
        ]
    );
}

#[tokio::test]
async fn propagates_publish_failures() {
    let publisher = publisher(Arc::new(Mutex::new(Vec::new())), true);
    let payload = NotificationStatusPayload::UserNotifications {
        user: user("macro|recipient@example.com"),
        updates: vec![PatchDelete::Delete {
            id: uuid::Uuid::nil(),
        }],
    };

    publisher
        .publish_updates(&payload)
        .await
        .expect_err("publish failure propagates");
}
