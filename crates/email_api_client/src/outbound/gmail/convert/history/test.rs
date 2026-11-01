use models_email::gmail::{
    HistoryListResponse, HistoryMessage, HistoryRecord, LabelAdded, MessageAdded, MessageDeleted,
};

use super::map_history_page;
use crate::domain::models::SyncCursor;

fn message(id: &str) -> HistoryMessage {
    HistoryMessage {
        id: id.into(),
        thread_id: "thread".into(),
    }
}

fn page(records: &[HistoryRecord]) -> HistoryListResponse {
    HistoryListResponse {
        history: Some(records.to_vec()),
        next_page_token: None,
        history_id: "cursor".into(),
    }
}

fn record(messages: &[&str], added: &[&str], deleted: &[&str], labelled: &[&str]) -> HistoryRecord {
    HistoryRecord {
        id: "1".into(),
        messages: Some(messages.iter().map(|id| message(id)).collect()),
        messages_added: Some(
            added
                .iter()
                .map(|id| MessageAdded {
                    message: message(id),
                })
                .collect(),
        ),
        messages_deleted: Some(
            deleted
                .iter()
                .map(|id| MessageDeleted {
                    message: message(id),
                })
                .collect(),
        ),
        labels_added: Some(
            labelled
                .iter()
                .map(|id| LabelAdded {
                    message: message(id),
                    label_ids: vec!["STARRED".into()],
                })
                .collect(),
        ),
        labels_removed: None,
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

    let page = map_history_page(response);

    assert_eq!(page.cursor, Some(SyncCursor::gmail("cursor-2")));
    assert!(page.changes.message_ids_to_upsert.contains("implicit"));
    assert!(page.changes.message_ids_to_delete.contains("deleted"));
    assert!(!page.changes.message_ids_to_upsert.contains("deleted"));
    assert!(page.changes.labels_to_update.contains("labels"));
}

#[test]
fn handles_an_empty_history_page() {
    let page = map_history_page(HistoryListResponse {
        history: None,
        next_page_token: Some("next".into()),
        history_id: "cursor".into(),
    });

    assert!(page.changes.message_ids_to_upsert.is_empty());
    assert_eq!(page.cursor, Some(SyncCursor::gmail("cursor")));
    assert_eq!(page.next_page_token.as_deref(), Some("next"));
}

#[test]
fn a_page_without_a_history_id_reports_no_cursor() {
    let page = map_history_page(HistoryListResponse {
        history: None,
        next_page_token: None,
        history_id: String::new(),
    });

    assert_eq!(page.cursor, None);
}

#[test]
fn appending_pages_matches_reading_the_history_in_one_pass() {
    // Each record interacts with earlier ones: deletions after upserts and
    // label changes, upserts and label changes after deletions, and upserts
    // after label changes.
    let records = [
        record(&[], &["a"], &[], &["b"]),
        record(&["c"], &[], &["a"], &["d"]),
        record(&[], &["a"], &[], &["c", "e"]),
        record(&["b"], &[], &["e", "f"], &[]),
        record(&[], &["g"], &[], &["f", "d"]),
        record(&["g"], &[], &["g"], &["h"]),
    ];
    let whole = map_history_page(page(&records)).changes;

    for first_split in 0..=records.len() {
        for second_split in first_split..=records.len() {
            let mut changes = map_history_page(page(&records[..first_split])).changes;
            changes
                .append_later(map_history_page(page(&records[first_split..second_split])).changes);
            changes.append_later(map_history_page(page(&records[second_split..])).changes);
            assert_eq!(
                changes, whole,
                "pages split after records {first_split} and {second_split}"
            );
        }
    }
}
