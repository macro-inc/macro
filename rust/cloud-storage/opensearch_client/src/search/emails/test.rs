use super::*;
use opensearch_query_builder::ToOpenSearchJson;

#[test]
fn test_build_search_request() -> anyhow::Result<()> {
    let builder = EmailQueryBuilder::new(vec!["test".to_string()])
        .match_type("exact")
        .page_size(20)
        .page(1)
        .user_id("user123")
        .search_on(SearchOn::Content)
        .collapse(true)
        .ids(vec!["thread1".to_string(), "thread2".to_string()]);

    let result = builder.build_search_request()?;

    let expected = serde_json::json!({
        "from": 20,
        "size": 20,
        "collapse": {
            "field": "thread_id"
        },
        "sort": EmailSearchConfig::default_sort_types().iter().map(|s| s.to_json()).collect::<Vec<_>>(),
        "highlight": EmailSearchConfig::default_highlight().to_json(),
        "query": {
            "bool": {
                "minimum_should_match": 1,
                "must": [
                    {
                        "match_phrase": {
                            "content": "test"
                        }
                    },
                ],
                "should": [
                    {
                        "terms": {
                            "thread_id": ["thread1", "thread2"]
                        }
                    },
                    {
                        "term": {
                            "user_id": "user123"
                        }
                    }
                ]
            }
        }
    });

    assert_eq!(result.to_json(), expected);

    Ok(())
}
