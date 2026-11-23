use serde_json::json;

use super::*;

fn child_query() -> QueryType<'static> {
    QueryType::term("content", "burger")
}

#[test]
fn inner_hits_return_the_whole_source_unless_fields_are_named() {
    let query = HasChildQuery::new("message", child_query())
        .inner_hits(InnerHits::new().name("term_0").size(5))
        .to_json();

    assert_eq!(
        query["has_child"]["inner_hits"],
        json!({"name": "term_0", "size": 5})
    );
}

#[test]
fn inner_hits_source_fields_serialize_as_a_source_filter() {
    let inner_hits = InnerHits::new()
        .name("term_0")
        .source_fields(["message_turn", "author"]);
    let query = HasChildQuery::new("message", child_query())
        .inner_hits(inner_hits.clone())
        .to_json();

    assert_eq!(
        query["has_child"]["inner_hits"],
        json!({"name": "term_0", "_source": ["message_turn", "author"]})
    );
    assert_eq!(inner_hits.to_owned().to_json(), inner_hits.to_json());
}
