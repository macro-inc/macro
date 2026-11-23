use super::*;
use crate::api::search::span_capture::SpanFields;
use models_search_cursor::SearchCursorOption;

/// The chat name search span says how long the term is, never what it is.
#[tokio::test]
async fn the_name_search_span_leaves_out_the_term() {
    let (fields, _guard) = SpanFields::install();
    let db = sqlx::postgres::PgPoolOptions::new()
        .connect_lazy("postgres://localhost/unused")
        .expect("a lazy pool never connects");
    let user_id = MacroUserId::parse_from_str("macro|user@example.com")
        .expect("valid user id")
        .lowercase();

    search_names(
        &db,
        &user_id,
        &FilterChatResponse {
            chat_ids: vec![],
            ids_only: false,
        },
        "severance offer".to_string(),
        &[],
        false,
        10,
        SearchCursorOption::Done,
    )
    .await
    .expect("an exhausted cursor returns before the database");

    let span = fields.of("search_names");
    assert_eq!(span["term_len"], "15");
    assert!(!span.contains_key("term"));
    assert!(span.values().all(|value| !value.contains("severance")));
}
