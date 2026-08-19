use super::SyncCursor;

#[test]
fn gmail_cursor_preserves_opaque_history_id_and_json() {
    let cursor = SyncCursor::gmail("history-123");

    assert_eq!(cursor, SyncCursor::Gmail("history-123".to_string()));
    assert_eq!(cursor.as_str(), "history-123");
    assert_eq!(
        serde_json::to_string(&cursor).unwrap(),
        r#"{"Gmail":"history-123"}"#
    );
    assert_eq!(
        serde_json::from_str::<SyncCursor>(r#"{"Gmail":"history-123"}"#).unwrap(),
        cursor
    );
}

#[test]
fn outlook_cursor_round_trips_opaque_delta_cursor() {
    let cursor = SyncCursor::outlook("https://graph.example/delta?$deltatoken=opaque");
    let json = r#"{"Outlook":"https://graph.example/delta?$deltatoken=opaque"}"#;

    assert_eq!(
        cursor,
        SyncCursor::Outlook("https://graph.example/delta?$deltatoken=opaque".to_string())
    );
    assert_eq!(
        cursor.as_str(),
        "https://graph.example/delta?$deltatoken=opaque"
    );
    assert_eq!(serde_json::to_string(&cursor).unwrap(), json);
    assert_eq!(serde_json::from_str::<SyncCursor>(json).unwrap(), cursor);
}
