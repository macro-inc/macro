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
        },
        SyncDocument {
            document_id: "document-b".to_string(),
            document_version_id: None,
            file_type: FileType::Pdf,
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
        })
    );
    assert_eq!(events[1].key(), "document-b");
    assert_eq!(
        events[1].event().event,
        DocumentTopicEvent::SyncContentUpdated(DocumentSyncContentUpdatedMetadata {
            document_id: "document-b".to_string(),
            file_type: FileType::Pdf,
            document_version_id: None,
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
            })
            .collect(),
    );

    let event_keys: Vec<&str> = events.iter().map(|event| event.key()).collect();
    assert_eq!(event_keys, ["document-a", "document-c", "document-b"]);
}
