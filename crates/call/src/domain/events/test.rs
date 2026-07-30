use chrono::{DateTime, Utc};
use macro_event_broker::{Event, MacroEvent};
use macro_event_topics::{MacroCallsTopic, Topic};
use macro_user_id::user_id::MacroUserIdStr;
use serde_json::{Value, json};
use uuid::Uuid;

use super::*;

const CALL_ID: &str = "0198a1b2-c3d4-7e5f-8061-728394a5b6c7";
const CHANNEL_ID: &str = "3f6f8b0a-6f9f-4a3f-9c3a-2b1e5d4c7a90";
const EVENT_ID: &str = "01998a30-1a2b-7c3d-9e4f-5a6b7c8d9e0f";

fn uuid(value: &str) -> Uuid {
    Uuid::parse_str(value).expect("valid uuid")
}

fn user_id(value: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(value.to_string()).expect("valid user id")
}

fn timestamp(value: &str) -> DateTime<Utc> {
    DateTime::parse_from_rfc3339(value)
        .expect("valid timestamp")
        .with_timezone(&Utc)
}

fn topic_events() -> Vec<(CallTopicEvent, Value)> {
    vec![
        (
            CallTopicEvent::Started(CallStartedMetadata {
                call_id: uuid(CALL_ID),
                channel_id: uuid(CHANNEL_ID),
                created_by: user_id("macro|creator@example.com"),
                created_at: timestamp("2026-07-27T18:01:02Z"),
                recording_enabled: true,
            }),
            json!({
                "event_type": "call.started",
                "metadata": {
                    "call_id": CALL_ID,
                    "channel_id": CHANNEL_ID,
                    "created_by": "macro|creator@example.com",
                    "created_at": "2026-07-27T18:01:02Z",
                    "recording_enabled": true,
                },
            }),
        ),
        (
            CallTopicEvent::RecordArchived(CallRecordArchivedMetadata {
                call_id: uuid(CALL_ID),
                channel_id: uuid(CHANNEL_ID),
                created_by: user_id("macro|creator@example.com"),
                started_at: timestamp("2026-07-27T18:01:02Z"),
                ended_at: timestamp("2026-07-27T18:03:07Z"),
                duration_ms: None,
                participant_count: 4,
                has_recording: true,
                archive_reason: CallArchiveReason::LastParticipantLeft,
            }),
            json!({
                "event_type": "call.record_archived",
                "metadata": {
                    "call_id": CALL_ID,
                    "channel_id": CHANNEL_ID,
                    "created_by": "macro|creator@example.com",
                    "started_at": "2026-07-27T18:01:02Z",
                    "ended_at": "2026-07-27T18:03:07Z",
                    "duration_ms": null,
                    "participant_count": 4,
                    "has_recording": true,
                    "archive_reason": "last_participant_left",
                },
            }),
        ),
        (
            CallTopicEvent::RecordUpdated(CallRecordUpdatedMetadata {
                call_id: uuid(CALL_ID),
                channel_id: uuid(CHANNEL_ID),
                actor_user_id: Some(user_id("macro|editor@example.com")),
                custom_name: Some("Weekly planning".to_string()),
                share_with_team: None,
            }),
            json!({
                "event_type": "call.record_updated",
                "metadata": {
                    "call_id": CALL_ID,
                    "channel_id": CHANNEL_ID,
                    "actor_user_id": "macro|editor@example.com",
                    "custom_name": "Weekly planning",
                    "share_with_team": null,
                },
            }),
        ),
        (
            CallTopicEvent::RecordDeleted(CallRecordDeletedMetadata {
                call_id: uuid(CALL_ID),
                channel_id: uuid(CHANNEL_ID),
                actor_user_id: None,
            }),
            json!({
                "event_type": "call.record_deleted",
                "metadata": {
                    "call_id": CALL_ID,
                    "channel_id": CHANNEL_ID,
                    "actor_user_id": null,
                },
            }),
        ),
        (
            CallTopicEvent::RecordSummarized(CallRecordSummarizedMetadata {
                call_id: uuid(CALL_ID),
                channel_id: uuid(CHANNEL_ID),
                ai_name_generated: true,
            }),
            json!({
                "event_type": "call.record_summarized",
                "metadata": {
                    "call_id": CALL_ID,
                    "channel_id": CHANNEL_ID,
                    "ai_name_generated": true,
                },
            }),
        ),
        (
            CallTopicEvent::RecordingReady(CallRecordingReadyMetadata {
                call_id: uuid(CALL_ID),
                channel_id: uuid(CHANNEL_ID),
            }),
            json!({
                "event_type": "call.recording_ready",
                "metadata": {
                    "call_id": CALL_ID,
                    "channel_id": CHANNEL_ID,
                },
            }),
        ),
    ]
}

fn macro_events() -> Vec<CallMacroEvent> {
    topic_events()
        .into_iter()
        .map(|(event, _)| match event {
            CallTopicEvent::Started(metadata) => CallMacroEvent::started(metadata),
            CallTopicEvent::RecordArchived(metadata) => CallMacroEvent::record_archived(metadata),
            CallTopicEvent::RecordUpdated(metadata) => CallMacroEvent::record_updated(metadata),
            CallTopicEvent::RecordDeleted(metadata) => CallMacroEvent::record_deleted(metadata),
            CallTopicEvent::RecordSummarized(metadata) => {
                CallMacroEvent::record_summarized(metadata)
            }
            CallTopicEvent::RecordingReady(metadata) => CallMacroEvent::recording_ready(metadata),
        })
        .collect()
}

#[test]
fn every_variant_has_exact_json_envelope() {
    let event_id = uuid(EVENT_ID);

    for (event, expected_payload) in topic_events() {
        let mut expected = expected_payload;
        let object = expected.as_object_mut().expect("expected object");
        object.insert("event_id".to_string(), json!(EVENT_ID));
        object.insert("schema_version".to_string(), json!(1));

        assert_eq!(
            serde_json::to_value(Event::with_event_id(event_id, event))
                .expect("serializable event"),
            expected
        );
    }
}

#[test]
fn every_variant_round_trips() {
    for original in macro_events() {
        let payload = serde_json::to_vec(original.event()).expect("serializable event");
        let decoded = CallMacroEvent::decode(original.key(), &payload).expect("decodable event");

        assert_eq!(decoded.key(), CALL_ID);
        assert_eq!(decoded.event(), original.event());
        assert_eq!(decoded.topic(), MacroCallsTopic::TOPIC_STR);
        assert_eq!(decoded.topic(), "macro.calls");
    }
}

#[test]
fn constructors_use_calls_topic_bare_call_id_key_and_schema_version_one() {
    for event in macro_events() {
        assert_eq!(event.key(), CALL_ID);
        assert!(!event.key().starts_with("call|"));
        assert_eq!(event.topic(), "macro.calls");
        assert_eq!(event.event().schema_version, 1);
    }
}

#[test]
fn archive_reasons_use_exact_wire_names() {
    assert_eq!(
        serde_json::to_value(CallArchiveReason::LastParticipantLeft)
            .expect("serializable archive reason"),
        "last_participant_left"
    );
    assert_eq!(
        serde_json::to_value(CallArchiveReason::RoomFinished).expect("serializable archive reason"),
        "room_finished"
    );
}

#[test]
fn metadata_excludes_private_call_content_and_locations() {
    let forbidden_fields = [
        "transcript",
        "transcript_text",
        "summary",
        "summary_text",
        "recording_url",
        "recording_key",
        "share_permission",
    ];

    for event in macro_events() {
        let value = serde_json::to_value(event.event()).expect("serializable event");
        let metadata = &value["metadata"];

        for field in forbidden_fields {
            assert!(
                !contains_field(metadata, field),
                "metadata included {field}"
            );
        }
    }
}

fn contains_field(value: &Value, field: &str) -> bool {
    match value {
        Value::Object(object) => {
            object.contains_key(field) || object.values().any(|value| contains_field(value, field))
        }
        Value::Array(values) => values.iter().any(|value| contains_field(value, field)),
        _ => false,
    }
}
