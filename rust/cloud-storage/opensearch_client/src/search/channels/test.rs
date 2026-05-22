use super::*;
use opensearch_query_builder::ToOpenSearchJson;

#[test]
fn test_build_bool_query() -> anyhow::Result<()> {
    let builder = ChannelMessageQueryBuilder::new(vec!["test".to_string()])
        .match_type("exact")
        .page_size(20)
        .page(1)
        .user_id("user123")
        .collapse(true)
        .ids(vec!["id1".to_string(), "id2".to_string()])
        .thread_ids(vec!["thread1".to_string(), "thread2".to_string()])
        .mentions(vec!["mention1".to_string(), "mention2".to_string()])
        .sender_ids(vec!["sender1".to_string(), "sender2".to_string()]);

    let result = builder.build_bool_query()?;

    let expected = serde_json::json!({
        "bool": {
            "must": [
                {
                    "bool": {
                        "minimum_should_match": 1,
                        "should": [
                            {"match_phrase": {"content": "test"}}
                        ]
                    }
                }
            ],
            "filter": [
                {
                    "bool": {
                        "minimum_should_match": 1,
                        "should": [
                            {"terms": {"entity_id": ["id1", "id2"]}},
                            {"term": {"sender_id": "user123"}}
                        ]
                    }
                },
                {"term": {"_index": "channels"}},
                {"terms": {"thread_id": ["thread1", "thread2"]}},
                {"terms": {"mentions": ["mention1", "mention2"]}},
                {"terms": {"sender_id": ["sender1", "sender2"]}}
            ]
        }
    });

    assert_eq!(result.build().to_json(), expected);

    Ok(())
}

#[test]
fn test_build_bool_query_multi_term_ands_inside_opensearch() -> anyhow::Result<()> {
    // Two terms — each becomes its own `match_phrase` clause and they
    // combine with `must` so both must appear in the same message.
    // Quoted phrases like "foo bar" arrive here as a single token and use
    // the same `match_phrase` path.
    let builder = ChannelMessageQueryBuilder::new(vec!["foo".to_string(), "bar baz".to_string()])
        .match_type("exact")
        .user_id("user123")
        .ids(vec!["id1".to_string()]);

    let result = builder.build_bool_query()?;

    let expected = serde_json::json!({
        "bool": {
            "must": [
                {
                    "bool": {
                        "minimum_should_match": 1,
                        "should": [
                            {
                                "bool": {
                                    "must": [
                                        { "match_phrase": { "content": "foo" } },
                                        { "match_phrase": { "content": "bar baz" } }
                                    ]
                                }
                            }
                        ]
                    }
                }
            ],
            "filter": [
                {
                    "bool": {
                        "minimum_should_match": 1,
                        "should": [
                            { "terms": { "entity_id": ["id1"] } },
                            { "term": { "sender_id": "user123" } }
                        ]
                    }
                },
                { "term": { "_index": "channels" } }
            ]
        }
    });

    assert_eq!(result.build().to_json(), expected);

    Ok(())
}
