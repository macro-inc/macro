use macro_event_broker::{Event, MacroEvent as _, TopicEvent};
use macro_user_id::user_id::MacroUserIdStr;
use model::document::FileType;
use serde_json::{Value, json};
use uuid::Uuid;

use super::{
    DocumentContentUploadedMetadata, DocumentInteractionMetadata, DocumentMacroEvent,
    DocumentPurgedMetadata, DocumentSyncContentUpdatedMetadata, DocumentTopicEvent,
    InteractionReason,
};

const DOCUMENT_ID: &str = "11111111-1111-1111-1111-111111111111";

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|owner@example.com".to_string()).expect("valid user id")
}

fn assert_wire_round_trip(event: Event<DocumentTopicEvent>, expected: Value) {
    assert_eq!(
        serde_json::to_value(&event).expect("event serializes"),
        expected
    );

    let decoded: Event<DocumentTopicEvent> =
        serde_json::from_value(expected).expect("event deserializes");
    assert_eq!(decoded, event);
}

#[test]
fn content_uploaded_serializes_to_the_exact_envelope() {
    let event = Event::with_event_id(
        Uuid::from_u128(1),
        DocumentTopicEvent::ContentUploaded(DocumentContentUploadedMetadata {
            document_id: DOCUMENT_ID.to_string(),
            owner: owner(),
            file_type: FileType::Pdf,
            document_version_id: Some("convert".to_string()),
        }),
    );

    assert_wire_round_trip(
        event,
        json!({
            "event_id": "00000000-0000-0000-0000-000000000001",
            "schema_version": 1,
            "event_type": "document.content_uploaded",
            "metadata": {
                "document_id": DOCUMENT_ID,
                "owner": "macro|owner@example.com",
                "file_type": "pdf",
                "document_version_id": "convert",
            },
        }),
    );
}

#[test]
fn sync_content_updated_serializes_to_the_exact_envelope() {
    let event = Event::with_event_id(
        Uuid::from_u128(2),
        DocumentTopicEvent::SyncContentUpdated(DocumentSyncContentUpdatedMetadata {
            document_id: DOCUMENT_ID.to_string(),
            file_type: FileType::Md,
            document_version_id: None,
            actor: None,
            on_behalf_of: None,
        }),
    );

    assert_wire_round_trip(
        event,
        json!({
            "event_id": "00000000-0000-0000-0000-000000000002",
            "schema_version": 1,
            "event_type": "document.sync_content_updated",
            "metadata": {
                "document_id": DOCUMENT_ID,
                "file_type": "md",
                "document_version_id": null,
            },
        }),
    );
}

#[test]
fn purged_serializes_to_the_exact_envelope() {
    let event = Event::with_event_id(
        Uuid::from_u128(3),
        DocumentTopicEvent::Purged(DocumentPurgedMetadata {
            document_id: DOCUMENT_ID.to_string(),
        }),
    );

    assert_wire_round_trip(
        event,
        json!({
            "event_id": "00000000-0000-0000-0000-000000000003",
            "schema_version": 1,
            "event_type": "document.purged",
            "metadata": {
                "document_id": DOCUMENT_ID,
            },
        }),
    );
}

#[test]
fn optional_document_versions_support_present_and_absent_values() {
    let events = [
        DocumentTopicEvent::ContentUploaded(DocumentContentUploadedMetadata {
            document_id: DOCUMENT_ID.to_string(),
            owner: owner(),
            file_type: FileType::Pdf,
            document_version_id: None,
        }),
        DocumentTopicEvent::SyncContentUpdated(DocumentSyncContentUpdatedMetadata {
            document_id: DOCUMENT_ID.to_string(),
            file_type: FileType::Md,
            document_version_id: Some("snapshot-7".to_string()),
            actor: None,
            on_behalf_of: None,
        }),
    ];

    let content_uploaded = serde_json::to_value(&events[0]).expect("event serializes");
    assert_eq!(
        content_uploaded["metadata"]["document_version_id"],
        Value::Null
    );

    let sync_content_updated = serde_json::to_value(&events[1]).expect("event serializes");
    assert_eq!(
        sync_content_updated["metadata"]["document_version_id"],
        "snapshot-7"
    );

    for event in events {
        let payload = serde_json::to_vec(&event).expect("event serializes");
        let decoded: DocumentTopicEvent =
            serde_json::from_slice(&payload).expect("event deserializes");
        assert_eq!(decoded, event);
    }
}

#[test]
fn search_event_constructors_use_the_document_key_and_schema_v1() {
    assert_eq!(<DocumentTopicEvent as TopicEvent>::SCHEMA_VERSION, 1);

    let content_metadata = DocumentContentUploadedMetadata {
        document_id: DOCUMENT_ID.to_string(),
        owner: owner(),
        file_type: FileType::Pdf,
        document_version_id: Some("version-1".to_string()),
    };
    let content_uploaded =
        DocumentMacroEvent::content_uploaded(DOCUMENT_ID, content_metadata.clone());
    assert_eq!(content_uploaded.key(), DOCUMENT_ID);
    assert_eq!(content_uploaded.event().schema_version, 1);
    assert_eq!(
        &content_uploaded.event().event,
        &DocumentTopicEvent::ContentUploaded(content_metadata)
    );

    let sync_metadata = DocumentSyncContentUpdatedMetadata {
        document_id: DOCUMENT_ID.to_string(),
        file_type: FileType::Md,
        document_version_id: None,
        actor: None,
        on_behalf_of: None,
    };
    let sync_content_updated =
        DocumentMacroEvent::sync_content_updated(DOCUMENT_ID, sync_metadata.clone());
    assert_eq!(sync_content_updated.key(), DOCUMENT_ID);
    assert_eq!(sync_content_updated.event().schema_version, 1);
    assert_eq!(
        &sync_content_updated.event().event,
        &DocumentTopicEvent::SyncContentUpdated(sync_metadata)
    );

    let purged_metadata = DocumentPurgedMetadata {
        document_id: DOCUMENT_ID.to_string(),
    };
    let purged = DocumentMacroEvent::purged(DOCUMENT_ID, purged_metadata.clone());
    assert_eq!(purged.key(), DOCUMENT_ID);
    assert_eq!(purged.event().schema_version, 1);
    assert_eq!(
        &purged.event().event,
        &DocumentTopicEvent::Purged(purged_metadata)
    );
}

#[test]
fn created_events_without_attribution_still_decode() {
    let payload = json!({
        "event_id": "00000000-0000-0000-0000-000000000005",
        "schema_version": 1,
        "event_type": "document.created",
        "metadata": {
            "document_id": DOCUMENT_ID,
            "owner": "macro|owner@example.com",
            "document_name": "notes",
            "file_type": null,
            "project_id": null,
            "sub_type": null,
            "created_at": null,
        },
    });

    let decoded: Event<DocumentTopicEvent> =
        serde_json::from_value(payload).expect("pre-attribution created event decodes");

    match decoded.event {
        DocumentTopicEvent::Created(metadata) => {
            assert_eq!(metadata.owner.as_ref(), "macro|owner@example.com");
            assert_eq!(metadata.actor, None);
            assert_eq!(metadata.on_behalf_of, None);
        }
        other => panic!("expected created, got {other:?}"),
    }
}

#[test]
fn existing_v1_document_events_still_decode() {
    let payload = json!({
        "event_id": "00000000-0000-0000-0000-000000000004",
        "schema_version": 1,
        "event_type": "document.interaction",
        "metadata": {
            "document_id": DOCUMENT_ID,
            "reason": "edited",
        },
    });

    let decoded = DocumentMacroEvent::decode(
        DOCUMENT_ID,
        &serde_json::to_vec(&payload).expect("payload serializes"),
    )
    .expect("existing v1 event decodes");

    assert_eq!(decoded.key(), DOCUMENT_ID);
    assert_eq!(decoded.event().schema_version, 1);
    assert_eq!(decoded.event().event_id, Uuid::from_u128(4));
    assert_eq!(
        &decoded.event().event,
        &DocumentTopicEvent::Interaction(DocumentInteractionMetadata {
            document_id: DOCUMENT_ID.to_string(),
            reason: InteractionReason::Edited,
        })
    );
}

#[test]
fn sync_extract_drops_invalid_attribution_strings() {
    let metadata = DocumentSyncContentUpdatedMetadata::from_extract(
        DOCUMENT_ID.to_string(),
        FileType::Md,
        None,
        Some("not-an-actor".to_string()),
        Some("also-not-a-user".to_string()),
    );
    assert_eq!(metadata.actor, None);
    assert_eq!(metadata.on_behalf_of, None);
}
