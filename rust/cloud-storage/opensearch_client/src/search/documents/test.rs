use super::*;
use opensearch_query_builder::ToOpenSearchJson;

#[test]
fn test_build_bool_query() -> anyhow::Result<()> {
    let builder = DocumentQueryBuilder::new(vec!["test".to_string()])
        .match_type("exact")
        .page_size(20)
        .page(1)
        .user_id("user123")
        .collapse(true)
        .ids(vec!["doc1".to_string(), "doc2".to_string()]);

    let result = builder.build_bool_query()?;

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
