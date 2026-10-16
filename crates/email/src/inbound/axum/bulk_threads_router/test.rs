use super::*;
use crate::domain::models::PreviewViewStandardLabel;

fn targets_request(json: serde_json::Value) -> Result<BulkThreadTargetsRequest, BulkThreadsError> {
    serde_json::from_value::<ListBulkThreadTargetsRequest>(json)
        .unwrap()
        .try_into()
}

fn action_batch(json: serde_json::Value) -> Result<BulkThreadActionBatch, BulkThreadsError> {
    serde_json::from_value::<ApplyBulkThreadActionRequest>(json)
        .unwrap()
        .try_into()
}

#[test]
fn select_all_below_in_signal_keeps_the_lists_query_and_starts_at_the_row() {
    let signal = serde_json::json!({
        "&": [
            { "l": { "Importance": true } },
            { "l": { "Shared": "exclude" } }
        ]
    });
    let request = targets_request(serde_json::json!({
        "ef": signal,
        "emailView": "inbox",
        "fromThreadId": "2a000005-0000-0000-0000-000000000005"
    }))
    .unwrap();

    assert_eq!(
        request.query.view,
        PreviewView::StandardLabel(PreviewViewStandardLabel::Inbox)
    );
    assert_eq!(serde_json::to_value(&request.query.filter).unwrap(), signal);
    assert!(matches!(
        request.start,
        BulkThreadStart::FromThread(id) if id == Uuid::from_u128(0x2a000005_0000_0000_0000_000000000005)
    ));
    assert_eq!(request.limit, MAX_BULK_THREAD_TARGETS_PAGE);
}

#[test]
fn a_cursor_continues_after_the_previous_page() {
    let request = targets_request(serde_json::json!({
        "emailView": "all",
        "cursor": {
            "threadId": "2a000006-0000-0000-0000-000000000006",
            "sortTs": "2024-02-05T10:00:00Z"
        },
        "limit": 50
    }))
    .unwrap();

    assert!(request.query.filter.is_none());
    assert_eq!(request.limit, 50);
    let BulkThreadStart::After(cursor) = request.start else {
        panic!("expected a cursor start, got {:?}", request.start);
    };
    assert_eq!(
        cursor.thread_id,
        Uuid::from_u128(0x2a000006_0000_0000_0000_000000000006)
    );
    assert_eq!(cursor.sort_ts.to_rfc3339(), "2024-02-05T10:00:00+00:00");
}

#[test]
fn no_anchor_starts_at_the_top_of_the_view() {
    let request = targets_request(serde_json::json!({ "emailView": "inbox" })).unwrap();

    assert!(matches!(request.start, BulkThreadStart::Top));
}

#[test]
fn an_anchor_and_a_cursor_together_are_rejected() {
    let result = targets_request(serde_json::json!({
        "emailView": "inbox",
        "fromThreadId": "2a000005-0000-0000-0000-000000000005",
        "cursor": {
            "threadId": "2a000006-0000-0000-0000-000000000006",
            "sortTs": "2024-02-05T10:00:00Z"
        }
    }));

    assert!(matches!(result, Err(BulkThreadsError::Validation(_))));
}

#[test]
fn action_names_map_to_their_domain_actions() {
    for (name, action) in [
        ("archive", BulkThreadAction::Archive),
        ("unarchive", BulkThreadAction::Unarchive),
        ("mark_read", BulkThreadAction::MarkRead),
        ("mark_unread", BulkThreadAction::MarkUnread),
    ] {
        let batch = action_batch(serde_json::json!({
            "threadIds": ["2a000005-0000-0000-0000-000000000005"],
            "action": name
        }))
        .unwrap();

        assert_eq!(
            batch,
            BulkThreadActionBatch {
                thread_ids: vec![Uuid::from_u128(0x2a000005_0000_0000_0000_000000000005)],
                action,
            }
        );
    }
}

#[test]
fn an_empty_batch_is_rejected() {
    let result = action_batch(serde_json::json!({ "threadIds": [], "action": "archive" }));

    assert!(matches!(result, Err(BulkThreadsError::Validation(_))));
}

#[test]
fn a_batch_over_the_limit_is_rejected() {
    let ids: Vec<Uuid> = (0..=MAX_BULK_THREAD_ACTION_BATCH as u128)
        .map(Uuid::from_u128)
        .collect();
    let result = action_batch(serde_json::json!({ "threadIds": ids, "action": "archive" }));

    assert!(matches!(result, Err(BulkThreadsError::Validation(_))));

    let at_limit = action_batch(serde_json::json!({
        "threadIds": &ids[..MAX_BULK_THREAD_ACTION_BATCH],
        "action": "archive"
    }))
    .unwrap();
    assert_eq!(at_limit.thread_ids.len(), MAX_BULK_THREAD_ACTION_BATCH);
}
