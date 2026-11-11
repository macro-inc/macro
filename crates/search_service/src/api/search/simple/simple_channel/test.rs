use super::*;
use models_search_cursor::SearchCursorOption;

/// Organization channels no longer exist, so an `org_id` filter matches no
/// channel. The search returns before touching the database, which a lazy
/// pool that never connects proves.
#[tokio::test]
async fn org_filter_matches_no_channel_names() {
    let db = sqlx::PgPool::connect_lazy("postgres://unused@localhost:1/unused")
        .expect("a lazy pool needs no server");
    let user_id = MacroUserId::parse_from_str("macro|member@test.com")
        .unwrap()
        .lowercase();
    let filters = ChannelFilters {
        org_id: Some(42),
        ..Default::default()
    };

    let (hits, cursor) = search_names(
        &db,
        &user_id,
        &filters,
        "macro".to_string(),
        false,
        10,
        SearchCursorOption::NotDone(None),
    )
    .await
    .expect("an org filter is not an error");

    assert!(hits.is_empty());
    assert!(cursor.is_done());
}
