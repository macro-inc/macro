use super::*;
use item_filters::ast::properties::DateRange;

#[sqlx::test(migrations = false)]
async fn date_range_guards_non_date_values_and_keeps_an_open_start(pool: sqlx::PgPool) {
    let literal = PropertiesLiteral {
        property_definition_id: Uuid::from_u128(0x00000001_0000_0000_0000_000000000004),
        entity_type: Some(PropertyEntityType::Thread),
        value: PropertyMatchValue::DateRange(DateRange {
            start: None,
            end: Some("2026-10-21T00:00:00Z".parse().unwrap()),
        }),
    };
    // The AST builds the predicate and bind list dynamically.
    let mut query = sqlx::QueryBuilder::new(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/fixtures/date_property_predicate.sql"
    )));
    build_thread_property_predicate(&literal, "t").push_into(&mut query, "unused");
    let matches = query
        .build_query_scalar::<String>()
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(matches, vec!["dated"]);
}
