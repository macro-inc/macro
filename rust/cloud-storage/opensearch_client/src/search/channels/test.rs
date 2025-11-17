use super::*;
use opensearch_query_builder::ToOpenSearchJson;

#[test]
fn test_build_search_request() -> anyhow::Result<()> {
    let builder = ChannelMessageQueryBuilder::new(vec!["test".to_string()])
        .match_type("exact")
        .page_size(20)
        .page(1)
        .user_id("user123")
        .search_on(SearchOn::Content)
        .collapse(true)
        .ids(vec!["id1".to_string(), "id2".to_string()])
        .thread_ids(vec!["thread1".to_string(), "thread2".to_string()])
        .mentions(vec!["mention1".to_string(), "mention2".to_string()])
        .sender_ids(vec!["sender1".to_string(), "sender2".to_string()]);

    let result = builder.build_search_request()?;

    let expected = serde_json::json!({
        "from": 20,
        "size": 20,
        "collapse": {
            "field": "entity_id"
        },
        "sort": ChannelMessageSearchConfig::default_sort_types().iter().map(|s| s.to_json()).collect::<Vec<_>>(),
        "highlight": ChannelMessageSearchConfig::default_highlight().to_json(),
        "query": {
            "bool": {
                "must": [
                    {
                        "match_phrase": {
                            "content": "test"
                        }
                    },
                    {
                        "terms": {
                            "thread_id": ["thread1", "thread2"]
                        }
                    },
                    {
                        "terms": {
                            "mentions": ["mention1", "mention2"]
                        }
                    },
                    {
                        "terms": {
                            "sender_id": ["sender1", "sender2"]
                        },
                    },
                ],
                "should": [
                    {
                        "terms": {
                            "entity_id": ["id1", "id2"]
                        }
                    },
                    {
                        "term": {
                            "sender_id": "user123"
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
