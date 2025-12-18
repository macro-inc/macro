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
      "collapse": {
        "field": "entity_id"
      },
      "from": 20,
      "highlight": ChannelMessageSearchConfig::append_owner_highlights(ChannelMessageSearchConfig::default_highlight()).to_json(),
      "query": {
        "bool": {
          "must": [
            {
              "bool": {
                "minimum_should_match": 1,
                "should": [
                  {
                    "wildcard": {
                      "sender_id": {
                        "case_insensitive": true,
                        "value": "macro|test*",
                        "boost": 5000.0
                      }
                    }
                  },
                  {
                    "match_phrase": {
                      "content": "test"
                    }
                  }
                ]
              }
            },
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
              }
            }
          ]
        }
      },
      "size": 20,
      "sort": [
        {
          "_score": "desc"
        },
        {
          "entity_id": "asc"
        },
        {
          "message_id": "asc"
        }
      ]
    });

    assert_eq!(result.to_json(), expected);

    Ok(())
}
