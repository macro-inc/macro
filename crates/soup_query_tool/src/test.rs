use ai_toolset::schema::generate_validated_input_schema;

use crate::{DescribeSoup, QuerySoup, ReadQuery};

#[test]
fn query_soup_schema_validates() {
    let schema = generate_validated_input_schema::<QuerySoup>().expect("QuerySoup schema");
    assert_eq!(schema.name, "QuerySoup");
    assert!(
        schema.description.len() < 9_000,
        "description grew to {} chars; the card is meant to stay small",
        schema.description.len()
    );
}

#[test]
fn describe_soup_schema_validates() {
    let schema = generate_validated_input_schema::<DescribeSoup>().expect("DescribeSoup schema");
    assert_eq!(schema.name, "DescribeSoup");
    let json = serde_json::to_string(&schema.schema).unwrap();
    for topic in ["DOCUMENT", "EMAIL_THREAD", "CHANNEL_MESSAGE", "PROPERTIES"] {
        assert!(json.contains(topic), "topic {topic} missing from {json}");
    }
}

#[test]
fn items_without_id_are_rejected() {
    let err = ReadQuery::parse("{ soup { items { displayName } } }", None).unwrap_err();
    assert!(matches!(err, crate::QueryRejected::ItemsWithoutId));
}

#[test]
fn items_without_id_are_rejected_through_fragments() {
    let err = ReadQuery::parse(
        "query { soup { items { ...Row } } } fragment Row on SoupEntity { displayName }",
        None,
    )
    .unwrap_err();
    assert!(matches!(err, crate::QueryRejected::ItemsWithoutId));
}

#[test]
fn id_selected_through_a_fragment_is_accepted() {
    ReadQuery::parse(
        "query { soup { items { ...Row } } } fragment Row on SoupEntity { id displayName }",
        None,
    )
    .unwrap();
}

#[test]
fn variables_must_be_an_object() {
    let err = ReadQuery::parse("{ __typename }", Some(serde_json::json!(["nope"]))).unwrap_err();
    assert!(matches!(err, crate::QueryRejected::VariablesNotObject));
}
