use super::*;
use item_filters::ast::properties::{DateRange, PropertyEntityType};
use uuid::Uuid;

#[sqlx::test(migrations = false)]
async fn date_range_guards_non_date_values_and_keeps_an_open_start(pool: PgPool) {
    let literal = PropertiesLiteral {
        property_definition_id: Uuid::from_u128(0x00000001_0000_0000_0000_000000000004),
        entity_type: Some(PropertyEntityType::Thread),
        value: PropertyMatchValue::DateRange(DateRange {
            start: None,
            end: Some("2026-10-21T00:00:00Z".parse().unwrap()),
        }),
    };
    // The AST determines the SQL predicate, so the query is genuinely dynamic.
    let query = format!(
        "{} {}",
        include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/fixtures/date_property_predicate.sql"
        )),
        property_literal_predicate(&literal)
    );
    let matches = sqlx::query_scalar::<_, String>(&query)
        .fetch_all(&pool)
        .await
        .unwrap();
    assert_eq!(matches, vec!["dated"]);
}
