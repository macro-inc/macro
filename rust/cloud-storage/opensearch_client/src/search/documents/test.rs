use crate::search::model::SearchResponse;

use super::*;
use opensearch_query_builder::ToOpenSearchJson;

#[test]
fn test_build_search_request() -> anyhow::Result<()> {
    let builder = DocumentQueryBuilder::new(vec!["test".to_string()])
        .match_type("exact")
        .page_size(20)
        .page(1)
        .user_id("user123")
        .search_on(SearchOn::Content)
        .collapse(true)
        .ids(vec!["doc1".to_string(), "doc2".to_string()]);

    let result = builder.build_search_request()?;

    let expected = serde_json::json!({
        "from": 20,
        "size": 20,
        "collapse": {
            "field": "entity_id"
        },
        "sort": DocumentSearchConfig::default_sort_types().iter().map(|s| s.to_json()).collect::<Vec<_>>(),
        "highlight": DocumentSearchConfig::default_highlight().to_json(),
        "query": {
            "bool": {
                "must": [
                    {
                        "match_phrase": {
                            "content": "test"
                        }
                    },
                    {"term": {"_index": "documents"}},
                ],
                "should": [
                    {
                        "terms": {
                            "entity_id": ["doc1", "doc2"]
                        }
                    },
                    {
                        "term": {
                            "owner_id": "user123"
                        }
                    }
                ],
                "minimum_should_match": 1,
            }
        }
    });

    assert_eq!(result.to_json(), expected);

    Ok(())
}
