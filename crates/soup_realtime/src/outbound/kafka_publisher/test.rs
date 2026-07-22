use std::sync::{Arc, Mutex};

use chrono::{DateTime, Utc};
use macro_event_broker::{
    EventBrokerError, EventPublisher, MacroEvent, MacroEventBrokerService, Topic,
};
use macro_user_id::user_id::MacroUserIdStr;
use models_soup::{document::SoupDocument, item::SoupItem};
use uuid::Uuid;

use super::*;

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

fn timestamp(seconds: i64) -> DateTime<Utc> {
    DateTime::from_timestamp(seconds, 0).expect("valid timestamp")
}

fn message() -> SoupRealtimeMessage {
    SoupRealtimeMessage::new(
        user(),
        SoupItem::Document(SoupDocument {
            id: Uuid::parse_str("00000000-0000-0000-0000-000000000001").expect("valid document id"),
            document_version_id: 9,
            owner_id: user(),
            name: "Published document".to_string(),
            file_type: Some("md".to_string()),
            sha: Some("sha".to_string()),
            project_id: None,
            branched_from_id: None,
            branched_from_version_id: None,
            document_family_id: None,
            created_at: timestamp(1),
            updated_at: timestamp(2),
            viewed_at: Some(timestamp(3)),
            sub_type: None,
            deleted_at: None,
            extra: (),
        }),
    )
}

#[tokio::test]
async fn publishes_typed_recipient_keyed_event_to_soup_topic() {
    let records = Arc::new(Mutex::new(Vec::new()));
    let broker = MacroEventBrokerService::new(RecordingPublisher {
        records: records.clone(),
        fail: false,
    });
    let adapter = KafkaSoupRealtimePublisher::new(broker);

    adapter.publish(message()).await.expect("publish succeeds");

    let mut records = records.lock().expect("records lock");
    let record = records.pop().expect("one record");
    assert!(records.is_empty());
    assert_eq!(record.topic, "macro.soup");
    assert_eq!(record.key, "macro|recipient@example.com");

    let json: serde_json::Value = serde_json::from_slice(&record.payload).expect("payload is JSON");
    assert!(json["event_id"].is_string());
    assert_eq!(json["schema_version"], 1);
    assert_eq!(json["event_type"], "soup.item.updated");
    assert_eq!(json["metadata"]["user_id"], "macro|recipient@example.com");

    let decoded = SoupMacroEvent::decode(record.key, &record.payload).expect("event round-trips");
    assert_eq!(decoded.event().schema_version, 1);
    let decoded = decoded.into_message();
    assert_eq!(decoded.user_id.as_ref(), "macro|recipient@example.com");
    match decoded.item {
        SoupItem::Document(document) => {
            assert_eq!(document.name, "Published document");
            assert_eq!(document.document_version_id, 9);
            assert_eq!(document.viewed_at, Some(timestamp(3)));
        }
        _ => panic!("expected document item"),
    }
}

#[tokio::test]
async fn propagates_delivery_failures_from_event_broker_service() {
    let broker = MacroEventBrokerService::new(RecordingPublisher {
        records: Arc::new(Mutex::new(Vec::new())),
        fail: true,
    });
    let adapter = KafkaSoupRealtimePublisher::new(broker);

    adapter
        .publish(message())
        .await
        .expect_err("delivery failure propagates");
}
