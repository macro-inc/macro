use super::SyncCursor;

#[test]
fn gmail_cursor_preserves_opaque_history_id() {
    let cursor = SyncCursor::gmail("history-123");

    assert_eq!(cursor, SyncCursor::Gmail("history-123".to_string()));
    assert_eq!(cursor.as_str(), "history-123");
}
