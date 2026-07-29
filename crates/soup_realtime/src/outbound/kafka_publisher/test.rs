use std::sync::{Arc, Mutex};

use macro_event_broker::{
    EventBrokerError, EventPublisher, GlobalSpawner, MacroEvent, MacroEventBrokerService, Topic,
};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::{Entity, EntityType};

use super::*;
use crate::domain::models::Patch;

const DOCUMENT_ID: &str = "00000000-0000-0000-0000-000000000001";

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

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|recipient@example.com".to_string()).expect("valid user id")
}

fn document() -> Entity<'static> {
    EntityType::Document.with_entity_string(DOCUMENT_ID.to_string())
}

fn message() -> SoupRealtimeMessage {
    SoupRealtimeMessage::new(user(), Patch::Updated(document()))
}

#[tokio::test]
async fn publishes_recipient_and_entity_patch_in_the_soup_topic_payload() {
    let records = Arc::new(Mutex::new(Vec::new()));
    let broker = MacroEventBrokerService::new(
        RecordingPublisher {
            records: records.clone(),
            fail: false,
        },
        GlobalSpawner,
    );
    let adapter = KafkaSoupRealtimePublisher::new(broker);

    adapter.publish(message()).await.expect("publish succeeds");

    let mut records = records.lock().expect("records lock");
    let record = records.pop().expect("one record");
    assert!(records.is_empty());
    assert_eq!(record.topic, "macro.soup");
    assert_eq!(record.key, "macro|recipient@example.com");

    let json: serde_json::Value = serde_json::from_slice(&record.payload).expect("payload is JSON");
    assert!(json["event_id"].is_string());
    assert_eq!(json["schema_version"], 2);
    assert_eq!(json["event_type"], "soup.updated");
    assert_eq!(json["metadata"][0], "macro|recipient@example.com");
    assert_eq!(json["metadata"][1]["entity_type"], "document");
    assert_eq!(json["metadata"][1]["entity_id"], DOCUMENT_ID);
    assert!(json.to_string().find("document_version_id").is_none());

    let decoded = SoupMacroEvent::decode(record.key, &record.payload).expect("event round-trips");
    assert_eq!(decoded.event().schema_version, 2);
    assert_eq!(
        decoded.into_message(),
        SoupRealtimeMessage::new(user(), Patch::Updated(document()))
    );
}

#[tokio::test]
async fn publishes_deleted_patches() {
    let records = Arc::new(Mutex::new(Vec::new()));
    let broker = MacroEventBrokerService::new(
        RecordingPublisher {
            records: records.clone(),
            fail: false,
        },
        GlobalSpawner,
    );
    let adapter = KafkaSoupRealtimePublisher::new(broker);

    adapter
        .publish(SoupRealtimeMessage::new(user(), Patch::Deleted(document())))
        .await
        .expect("publish succeeds");

    let records = records.lock().expect("records lock");
    let json: serde_json::Value =
        serde_json::from_slice(&records[0].payload).expect("payload is JSON");
    assert_eq!(json["event_type"], "soup.deleted");
}

#[tokio::test]
async fn propagates_delivery_failures_from_event_broker_service() {
    let broker = MacroEventBrokerService::new(
        RecordingPublisher {
            records: Arc::new(Mutex::new(Vec::new())),
            fail: true,
        },
        GlobalSpawner,
    );
    let adapter = KafkaSoupRealtimePublisher::new(broker);

    adapter
        .publish(message())
        .await
        .expect_err("delivery failure propagates");
}
