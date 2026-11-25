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
        &[],
        false,
        10,
        SearchCursorOption::NotDone(None),
    )
    .await
    .expect("an org filter is not an error");

    assert!(hits.is_empty());
    assert!(cursor.is_done());
}

/// The channel name search span says how long the term is and how many words
/// it leaves out, never what they are or who searched.
#[tokio::test]
async fn the_name_search_span_leaves_out_the_words_and_the_searcher() {
    let (fields, _guard) = crate::api::search::span_capture::SpanFields::install();
    let db = sqlx::postgres::PgPoolOptions::new()
        .connect_lazy("postgres://localhost/unused")
        .expect("a lazy pool needs no server");
    let user_id = MacroUserId::parse_from_str("macro|member@example.com")
        .unwrap()
        .lowercase();

    search_names(
        &db,
        &user_id,
        &ChannelFilters::default(),
        "severance offer".to_string(),
        &["redundancy plan".to_string()],
        false,
        10,
        SearchCursorOption::Done,
    )
    .await
    .expect("an exhausted cursor returns before the database");

    let span = fields.of("search_names");
    assert_eq!(span["term_len"], "15");
    assert_eq!(span["excluded_terms"], "1");
    assert!(!span.contains_key("user_id"));
    assert!(span.values().all(|value| {
        !value.contains("severance") && !value.contains("redundancy") && !value.contains('@')
    }));
}
