use super::*;
use opensearch_query_builder::ToOpenSearchJson;

#[test]
fn test_build_search_request() -> anyhow::Result<()> {
    let builder = ChatQueryBuilder::new(vec!["test".to_string()])
        .match_type("exact")
        .page_size(20)
        .page(1)
        .user_id("user123")
        .search_on(SearchOn::Content)
        .collapse(true)
        .ids(vec!["chat1".to_string(), "chat2".to_string()])
        .role(vec!["user".to_string(), "assistant".to_string()]);

    let result = builder.build_search_request()?;

    let expected = serde_json::json!({
        "from": 20,
        "size": 20,
        "collapse": {
            "field": "entity_id"
        },
        "sort": ChatSearchConfig::default_sort_types().iter().map(|s| s.to_json()).collect::<Vec<_>>(),
        "highlight": ChatSearchConfig::default_highlight().to_json(),
        "query": {
            "bool": {
                "must": [
                    {
                        "match_phrase": {
                            "content": "test"
                        }
                    },
                    {"term": {"_index": "chats"}},
                    {
                        "bool": {
                            "minimum_should_match": 1,
                            "should": [
                                {
                                    "wildcard": {
                                        "role": {
                                            "case_insensitive": true,
                                            "value": "*user*"
                                        }
                                    }
                                },
                                {
                                    "wildcard": {
                                        "role": {
                                            "case_insensitive": true,
                                            "value": "*assistant*"
                                        }
                                    }
                                }
                            ]
                        }
                    }
                ],
                "should": [
                    {
                        "terms": {
                            "entity_id": ["chat1", "chat2"]
                        }
                    },
                    {
                        "term": {
                            "user_id": "user123"
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
