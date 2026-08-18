use models_email::gmail::{
    HistoryListResponse, HistoryMessage, HistoryRecord, LabelAdded, MessageAdded, MessageDeleted,
};

use super::map_history_list_response_to_changes;
use crate::domain::models::SyncCursor;

fn message(id: &str) -> HistoryMessage {
    HistoryMessage {
        id: id.into(),
        thread_id: "thread".into(),
    }
}

#[test]
fn resolves_overlapping_changes_with_deletion_precedence() {
    let response = HistoryListResponse {
        history_id: "cursor-2".into(),
        next_page_token: None,
        history: Some(vec![HistoryRecord {
            id: "1".into(),
            messages: Some(vec![message("implicit")]),
            messages_added: Some(vec![MessageAdded {
                message: message("deleted"),
            }]),
            messages_deleted: Some(vec![MessageDeleted {
                message: message("deleted"),
            }]),
            labels_added: Some(vec![LabelAdded {
                message: message("labels"),
                label_ids: vec!["STARRED".into()],
            }]),
            labels_removed: None,
        }]),
    };

    let batch = map_history_list_response_to_changes(response);

    assert_eq!(batch.next_cursor, SyncCursor::gmail("cursor-2"));
    assert!(batch.changes.message_ids_to_upsert.contains("implicit"));
    assert!(batch.changes.message_ids_to_delete.contains("deleted"));
    assert!(!batch.changes.message_ids_to_upsert.contains("deleted"));
    assert!(batch.changes.labels_to_update.contains("labels"));
}

#[test]
fn handles_an_empty_history_page() {
    let batch = map_history_list_response_to_changes(HistoryListResponse {
        history: None,
        next_page_token: None,
        history_id: "cursor".into(),
    });

    assert!(batch.changes.message_ids_to_upsert.is_empty());
    assert_eq!(batch.next_cursor.as_str(), "cursor");
}
