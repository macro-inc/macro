use super::*;
use opensearch_query_builder::ToOpenSearchJson;

#[test]
fn test_build_bool_query_join_shape() -> anyhow::Result<()> {
    let builder = ChatQueryBuilder::new(vec!["test".to_string()])
        .match_type("exact")
        .page_size(20)
        .page(1)
        .user_id("user123")
        .collapse(true)
        .ids(vec!["chat1".to_string(), "chat2".to_string()])
        .role(vec!["user".to_string(), "assistant".to_string()]);

    let json = builder.build_bool_query()?.build().to_json();

    let filter = json["bool"]["filter"].as_array().expect("filter array");
    assert!(
        filter.contains(&serde_json::json!({"term": {"_index": "chats"}})),
        "filter must constrain to chats index: {filter:?}"
    );
    assert!(
        filter.contains(&serde_json::json!({"term": {"chat_relation": "chat"}})),
        "filter must constrain to parent chats: {filter:?}"
    );
    assert!(
        filter.contains(&serde_json::json!({
            "bool": {
                "minimum_should_match": 1,
                "should": [
                    {"terms": {"entity_id": ["chat1", "chat2"]}},
                    {"term": {"user_id": "user123"}}
                ]
            }
        })),
        "filter must constrain to ids or owner: {filter:?}"
    );

    let must = json["bool"]["must"].as_array().expect("must array");
    assert_eq!(must.len(), 1, "expected one has_child per term: {must:?}");

    let has_child = &must[0]["has_child"];
    assert_eq!(has_child["type"], "message");
    assert_eq!(has_child["inner_hits"]["name"], "term_0");

    // role is a child-side field: it must sit inside the has_child query
    // alongside the term match, so the same message that matches the term
    // is also from one of the requested roles.
    let inner_must = has_child["query"]["bool"]["must"]
        .as_array()
        .expect("has_child query must array");
    assert!(
        inner_must.contains(&serde_json::json!({"match_phrase": {"content": "test"}})),
        "has_child query must match the term: {inner_must:?}"
    );
    assert!(
        inner_must.contains(&serde_json::json!({
            "bool": {
                "minimum_should_match": 1,
                "should": [
                    {"wildcard": {"role": {"case_insensitive": true, "value": "*user*"}}},
                    {"wildcard": {"role": {"case_insensitive": true, "value": "*assistant*"}}}
                ]
            }
        })),
        "has_child query must filter on role: {inner_must:?}"
    );

    Ok(())
}

#[test]
fn test_build_bool_query_tag_filter_emits_nested_terms() -> anyhow::Result<()> {
    let builder = ChatQueryBuilder::new(vec!["foo".to_string()])
        .match_type("partial")
        .user_id("alice")
        .tag_option_ids(vec![
            "00000001-0000-0000-0003-000000000001".to_string(),
            "00000001-0000-0000-0003-000000000002".to_string(),
        ]);

    let json = builder.build_bool_query()?.build().to_json();
    let filter = json["bool"]["filter"].as_array().expect("filter array");

    let nested: Vec<&serde_json::Value> = filter
        .iter()
        .filter(|f| f.get("nested").is_some())
        .collect();
    assert_eq!(
        nested.len(),
        1,
        "tags collapse to one nested clause: {filter:?}"
    );

    let tags = &nested[0]["nested"];
    assert_eq!(tags["path"], "properties");
    assert_eq!(tags["ignore_unmapped"], true);
    // No definition_id term: match is on the globally-unique option ids alone.
    assert_eq!(
        tags["query"],
        serde_json::json!({
            "terms": {"properties.values": [
                "00000001-0000-0000-0003-000000000001",
                "00000001-0000-0000-0003-000000000002"
            ]}
        })
    );

    Ok(())
}

#[test]
fn test_build_bool_query_tag_filter_empty_skipped() -> anyhow::Result<()> {
    let builder = ChatQueryBuilder::new(vec!["foo".to_string()])
        .match_type("partial")
        .user_id("alice")
        .tag_option_ids(vec![]);

    let json = builder.build_bool_query()?.build().to_json();
    let filter = json["bool"]["filter"].as_array().expect("filter array");
    assert!(
        !filter.iter().any(|f| f.get("nested").is_some()),
        "empty tag_option_ids should emit no nested clause: {filter:?}"
    );
    Ok(())
}
