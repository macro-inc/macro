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
        .ids(vec!["thread1".to_string(), "thread2".to_string()])
        .link_ids(vec!["link1".to_string(), "link2".to_string()])
        .sender(vec!["sender@example.com".to_string()])
        .cc(vec!["cc@example.com".to_string()])
        .bcc(vec!["bcc@example.com".to_string()])
        .recipients(vec!["recipient@example.com".to_string()]);

    let result = builder.build_search_request()?;

    let expected = serde_json::json!({
        "from": 20,
        "size": 20,
        "collapse": {
            "field": "entity_id"
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
                    {"term": {"_index": "emails"}},
                    {
                        "terms": {
                            "link_id": ["link1", "link2"]
                        }
                    },
                    {
                        "bool": {
                            "minimum_should_match": 1,
                            "should": [
                                {
                                    "wildcard": {
                                        "sender": {
                                            "case_insensitive": true,
                                            "value": "*sender@example.com*"
                                        }
                                    }
                                }
                            ]
                        }
                    },
                    {
                        "bool": {
                            "minimum_should_match": 1,
                            "should": [
                                {
                                    "wildcard": {
                                        "cc": {
                                            "case_insensitive": true,
                                            "value": "*cc@example.com*"
                                        }
                                    }
                                }
                            ]
                        }
                    },
                    {
                        "bool": {
                            "minimum_should_match": 1,
                            "should": [
                                {
                                    "wildcard": {
                                        "bcc": {
                                            "case_insensitive": true,
                                            "value": "*bcc@example.com*"
                                        }
                                    }
                                }
                            ]
                        }
                    },
                    {
                        "bool": {
                            "minimum_should_match": 1,
                            "should": [
                                {
                                    "wildcard": {
                                        "recipients": {
                                            "case_insensitive": true,
                                            "value": "*recipient@example.com*"
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
                            "entity_id": ["thread1", "thread2"]
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
