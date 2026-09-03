use documents::domain::events::{DocumentSyncContentUpdatedMetadata, DocumentTopicEvent};
use macro_event_broker::MacroEvent as _;
use model::document::FileType;

use super::{SyncDocument, documents_to_events};

#[test]
fn documents_map_to_events_with_matching_keys_and_exact_metadata() {
    let events = documents_to_events(vec![
        SyncDocument {
            document_id: "document-a".to_string(),
            document_version_id: Some("version-42".to_string()),
            file_type: FileType::Md,
            actor: None,
            on_behalf_of: None,
        },
        SyncDocument {
            document_id: "document-b".to_string(),
            document_version_id: None,
            file_type: FileType::Pdf,
            actor: None,
            on_behalf_of: None,
        },
    ]);

    assert_eq!(events.len(), 2);
    assert_eq!(events[0].key(), "document-a");
    assert_eq!(
        events[0].event().event,
        DocumentTopicEvent::SyncContentUpdated(DocumentSyncContentUpdatedMetadata {
            document_id: "document-a".to_string(),
            file_type: FileType::Md,
            document_version_id: Some("version-42".to_string()),
            actor: None,
            on_behalf_of: None,
        })
    );
    assert_eq!(events[1].key(), "document-b");
    assert_eq!(
        events[1].event().event,
        DocumentTopicEvent::SyncContentUpdated(DocumentSyncContentUpdatedMetadata {
            document_id: "document-b".to_string(),
            file_type: FileType::Pdf,
            document_version_id: None,
            actor: None,
            on_behalf_of: None,
        })
    );
}

#[test]
fn documents_map_to_one_event_each_in_input_order() {
    let events = documents_to_events(
        ["document-a", "document-c", "document-b"]
            .into_iter()
            .map(|document_id| SyncDocument {
                document_id: document_id.to_string(),
                document_version_id: None,
                file_type: FileType::Md,
                actor: None,
                on_behalf_of: None,
            })
            .collect(),
    );

    let event_keys: Vec<&str> = events.iter().map(|event| event.key()).collect();
    assert_eq!(event_keys, ["document-a", "document-c", "document-b"]);
}

#[test]
fn documents_forward_sync_attribution() {
    let events = documents_to_events(vec![SyncDocument {
        document_id: "document-a".to_string(),
        document_version_id: None,
        file_type: FileType::Md,
        actor: Some("bot|00000000-0000-0000-0000-00000000a1a1".to_string()),
        on_behalf_of: Some("macro|owner@example.com".to_string()),
    }]);

    let DocumentTopicEvent::SyncContentUpdated(metadata) = &events[0].event().event else {
        panic!("expected sync_content_updated");
    };
    assert_eq!(
        metadata.actor.as_ref().map(|actor| actor.as_ref()),
        Some("bot|00000000-0000-0000-0000-00000000a1a1")
    );
    assert_eq!(
        metadata.on_behalf_of.as_ref().map(|user| user.as_ref()),
        Some("macro|owner@example.com")
    );
}
