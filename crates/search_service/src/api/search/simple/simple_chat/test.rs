use super::*;
use models_search_cursor::SearchCursorOption;

/// Chat filters that narrow to no accessible chat (a Drive folder without
/// chats, an owner with none) leave an ids-only search over no ids. That
/// matches no chat names rather than failing the unified search, and returns
/// before touching the database, which a lazy pool that never connects proves.
#[tokio::test]
async fn ids_only_filter_without_chats_matches_no_chat_names() {
    let db = sqlx::PgPool::connect_lazy("postgres://unused@localhost:1/unused")
        .expect("a lazy pool needs no server");
    let user_id = MacroUserId::parse_from_str("macro|member@example.com")
        .unwrap()
        .lowercase();
    let filter_chat_response = FilterChatResponse {
        chat_ids: vec![],
        ids_only: true,
    };

    let (hits, cursor) = search_names(
        &db,
        &user_id,
        &filter_chat_response,
        "project".to_string(),
        &[],
        false,
        10,
        SearchCursorOption::NotDone(None),
    )
    .await
    .expect("filters that narrow to no chats are not an error");

    assert!(hits.is_empty());
    assert!(cursor.is_done());
}
