use super::*;
use opensearch_query_builder::ToOpenSearchJson;

// `build_bool_query` dispatches on `alias_uses_join_shape()`, which is
// cached via OnceLock for the process lifetime — so tests call the
// explicit flat/join variants directly to stay deterministic regardless
// of env state.

#[test]
fn test_build_bool_query_flat_shape() -> anyhow::Result<()> {
    let builder = DocumentQueryBuilder::new(vec!["test".to_string()])
        .match_type("exact")
        .page_size(20)
        .page(1)
        .user_id("user123")
        .collapse(true)
        .ids(vec!["doc1".to_string(), "doc2".to_string()]);

    let result = builder.build_bool_query_flat()?;

    let expected = serde_json::json!({
        "bool": {
            "filter": [
                {
                    "bool": {
                        "minimum_should_match": 1,
                        "should": [
                            {"terms": {"entity_id": ["doc1", "doc2"]}},
                            {"term": {"owner_id": "user123"}}
                        ]
                    }
                },
                {"term": {"_index": "documents"}}
            ],
            "must": [
                {
                    "bool": {
                        "minimum_should_match": 1,
                        "should": [
                            {"match_phrase": {"content": "test"}}
                        ]
                    }
                }
            ]
        }
    });

    assert_eq!(result.build().to_json(), expected);

    Ok(())
}

#[test]
fn test_build_bool_query_join_shape_multi_term_and() -> anyhow::Result<()> {
    let builder = DocumentQueryBuilder::new(vec!["foo".to_string(), "bar".to_string()])
        .match_type("partial")
        .page_size(20)
        .page(0)
        .user_id("alice");

    let json = builder.build_bool_query_join()?.build().to_json();

    let filter = json["bool"]["filter"].as_array().expect("filter array");
    assert!(
        filter.contains(&serde_json::json!({"term": {"_index": "documents"}})),
        "filter must constrain to documents index: {filter:?}"
    );
    assert!(
        filter.contains(&serde_json::json!({"term": {"document_relation": "document"}})),
        "filter must constrain to parent docs: {filter:?}"
    );
    assert!(
        filter.contains(&serde_json::json!({"term": {"owner_id": "alice"}})),
        "filter must constrain to owner: {filter:?}"
    );

    let must = json["bool"]["must"].as_array().expect("must array");
    assert_eq!(must.len(), 2, "expected one has_child per term: {must:?}");

    let term_match = |val: &serde_json::Value, expected_term: &str, expected_type: &str| {
        let has_child = &val["has_child"];
        assert_eq!(has_child["type"], "chunk");
        assert_eq!(
            has_child["query"][expected_type]["content"]["query"],
            expected_term
        );
    };
    term_match(&must[0], "foo", "match_phrase_prefix");
    term_match(&must[1], "bar", "match_phrase_prefix");

    Ok(())
}

#[test]
fn test_build_bool_query_join_shape_quoted_phrase_uses_match_phrase() -> anyhow::Result<()> {
    // A term that came from a quoted phrase has internal whitespace and
    // should fall back to match_phrase (no prefix expansion).
    let builder = DocumentQueryBuilder::new(vec!["deal review".to_string()])
        .match_type("partial")
        .user_id("alice");

    let json = builder.build_bool_query_join()?.build().to_json();
    let must = &json["bool"]["must"][0]["has_child"]["query"];
    assert!(
        must.get("match_phrase").is_some(),
        "quoted phrase should use match_phrase, got {must:?}"
    );
    assert_eq!(must["match_phrase"]["content"], "deal review");
    Ok(())
}

#[test]
fn test_build_bool_query_join_shape_short_term_no_prefix() -> anyhow::Result<()> {
    let builder = DocumentQueryBuilder::new(vec!["ab".to_string()])
        .match_type("partial")
        .user_id("alice");

    let json = builder.build_bool_query_join()?.build().to_json();
    let must = &json["bool"]["must"][0]["has_child"]["query"];
    assert!(
        must.get("match_phrase").is_some(),
        "short term should use match_phrase, got {must:?}"
    );
    Ok(())
}

#[test]
fn test_build_bool_query_join_shape_exact_match_type_uses_match_phrase() -> anyhow::Result<()> {
    let builder = DocumentQueryBuilder::new(vec!["release".to_string()])
        .match_type("exact")
        .user_id("alice");

    let json = builder.build_bool_query_join()?.build().to_json();
    let must = &json["bool"]["must"][0]["has_child"]["query"];
    assert!(
        must.get("match_phrase").is_some(),
        "match_type=exact should use match_phrase, got {must:?}"
    );
    Ok(())
}

#[test]
fn test_build_bool_query_join_shape_ids_only_filter() -> anyhow::Result<()> {
    let builder = DocumentQueryBuilder::new(vec!["foo".to_string()])
        .match_type("partial")
        .user_id("alice")
        .ids(vec!["doc1".to_string(), "doc2".to_string()])
        .ids_only(true);

    let json = builder.build_bool_query_join()?.build().to_json();
    let filter = json["bool"]["filter"].as_array().expect("filter array");
    assert!(
        filter.contains(&serde_json::json!({
            "terms": { "entity_id": ["doc1", "doc2"] }
        })),
        "ids_only should restrict to entity_id terms: {filter:?}"
    );
    assert!(
        !filter
            .iter()
            .any(|f| f.get("term").and_then(|t| t.get("owner_id")).is_some()),
        "ids_only should not include owner filter: {filter:?}"
    );
    Ok(())
}

#[test]
fn test_build_bool_query_join_shape_sub_type_filter() -> anyhow::Result<()> {
    let builder = DocumentQueryBuilder::new(vec!["foo".to_string()])
        .match_type("partial")
        .user_id("alice")
        .sub_types(vec!["task".to_string()]);

    let json = builder.build_bool_query_join()?.build().to_json();
    let filter = json["bool"]["filter"].as_array().expect("filter array");
    assert!(
        filter.contains(&serde_json::json!({"terms": {"sub_type": ["task"]}})),
        "sub_type filter should be on the parent: {filter:?}"
    );
    Ok(())
}

#[test]
fn test_build_bool_query_join_shape_has_inner_hits() -> anyhow::Result<()> {
    let builder = DocumentQueryBuilder::new(vec!["foo".to_string(), "bar".to_string()])
        .match_type("partial")
        .user_id("alice");

    let json = builder.build_bool_query_join()?.build().to_json();
    let must = json["bool"]["must"].as_array().expect("must array");
    for (idx, clause) in must.iter().enumerate() {
        let inner = &clause["has_child"]["inner_hits"];
        assert!(
            inner.is_object(),
            "expected inner_hits on has_child clause {idx}: {clause:?}"
        );
        assert_eq!(
            inner["name"],
            format!("term_{idx}"),
            "inner_hits name should be term_<idx>"
        );
    }
    Ok(())
}

#[test]
fn document_index_deserializes_parent_shape_with_no_node_id_or_raw_content() {
    // Join-shape parent docs only carry parent metadata in `_source`;
    // `node_id` and `raw_content` are child-only fields and are
    // absent. Deserialization has to succeed (otherwise the unified
    // search response 500s on any v2 hit) and produce None for both.
    let parent = serde_json::json!({
        "entity_id": "00000000-0000-0000-0000-000000000001",
        "document_name": "Q3 Planning",
        "owner_id": "macro|alice@example.com",
        "file_type": "pdf",
        "updated_at_seconds": 1779000000_i64,
        "document_relation": "document",
    });

    let doc: DocumentIndex =
        serde_json::from_value(parent).expect("parent _source should deserialize");
    assert!(doc.node_id.is_none(), "parent shape should have no node_id");
    assert!(
        doc.raw_content.is_none(),
        "parent shape should have no raw_content"
    );
}

#[test]
fn document_index_deserializes_flat_chunk_shape_with_node_id() {
    // Flat-shape chunk docs carry node_id (and optionally raw_content)
    // directly. Make sure they keep deserializing after the move to
    // Option<String>.
    let chunk = serde_json::json!({
        "entity_id": "00000000-0000-0000-0000-000000000001",
        "document_name": "Q3 Planning",
        "node_id": "0",
        "owner_id": "macro|alice@example.com",
        "file_type": "pdf",
        "content": "Page text",
        "updated_at_seconds": 1779000000_i64,
    });

    let doc: DocumentIndex = serde_json::from_value(chunk).expect("flat chunk should deserialize");
    assert_eq!(doc.node_id.as_deref(), Some("0"));
}
