use ai_toolset::schema::generate_validated_input_schema;

use crate::QuerySoup;
use crate::ReadQuery;

#[test]
fn query_soup_schema_validates() {
    let schema = generate_validated_input_schema::<QuerySoup>().expect("QuerySoup schema");
    assert_eq!(schema.name, "QuerySoup");
    assert!(
        schema.description.len() < 64_000,
        "description grew to {} chars; keep it a deliberate act",
        schema.description.len()
    );
}

#[test]
fn items_without_id_are_rejected() {
    let err = ReadQuery::parse("{ soup { items { displayName } } }", None).unwrap_err();
    assert!(matches!(err, crate::QueryRejected::ItemsWithoutId));
}

#[test]
fn variables_must_be_an_object() {
    let err = ReadQuery::parse("{ __typename }", Some(serde_json::json!(["nope"]))).unwrap_err();
    assert!(matches!(err, crate::QueryRejected::VariablesNotObject));
}
