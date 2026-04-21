use super::*;

use opensearch_query_builder::ToOpenSearchJson;

struct TestSearchConfig;

impl SearchQueryConfig for TestSearchConfig {
    const USER_ID_KEY: &'static str = "test_user_id";
    const TITLE_KEY: &'static str = "test_title";
    const ENTITY_INDEX: OpenSearchEntityType = OpenSearchEntityType::Documents;
}

#[test]
fn test_build_filter_query() -> anyhow::Result<()> {
    // Test ids only
    let ids = vec!["id1".to_string(), "id2".to_string()];
    let builder = SearchQueryBuilder::<TestSearchConfig>::new(vec!["test".to_string()])
        .user_id("user123")
        .ids(ids.clone())
        .ids_only(true);

    let result = builder.build_filter_query(TestSearchConfig::USER_ID_KEY)?;

    let expected = serde_json::json!({
        "terms": {
            "entity_id": ["id1", "id2"]
        }
    });

    assert_eq!(result.to_json(), expected);

    // Test !ids_only with no ids
    let builder = SearchQueryBuilder::<TestSearchConfig>::new(vec!["test".to_string()])
        .user_id("user123")
        .ids(vec![])
        .ids_only(false);

    let result = builder.build_filter_query(TestSearchConfig::USER_ID_KEY)?;

    let expected = serde_json::json!({
        "term": {
            "test_user_id": "user123"
        }
    });

    assert_eq!(result.to_json(), expected);

    // Test !ids_only with ids
    let builder = SearchQueryBuilder::<TestSearchConfig>::new(vec!["test".to_string()])
        .user_id("user123")
        .ids(ids.clone())
        .ids_only(false);

    let result = builder.build_filter_query(TestSearchConfig::USER_ID_KEY)?;

    let expected = serde_json::json!({
        "bool": {
            "minimum_should_match": 1,
            "should": [
                {
                    "terms": {
                        "entity_id": ["id1", "id2"]
                    }
                },
                {
                    "term": {
                        "test_user_id": "user123"
                    }
                }
            ]
        }
    });

    assert_eq!(result.to_json(), expected);

    Ok(())
}

#[test]
fn test_build_contentquery_empty_ids() -> anyhow::Result<()> {
    // Empty ids ok with ids only false
    let term = vec!["test".to_string()];
    let ids: Vec<String> = vec![];
    let user_id = "user123";
    let page = 1;
    let page_size = 20;

    let builder = SearchQueryBuilder::<TestSearchConfig>::new(term.clone())
        .match_type("exact")
        .page_size(page_size)
        .page(page)
        .user_id(user_id)
        .ids(ids.clone())
        .ids_only(false);

    let result = builder.build_content_bool_query();

    assert!(result.is_ok());

    // Empty ids fails with ids only true
    let builder = SearchQueryBuilder::<TestSearchConfig>::new(term.clone())
        .match_type("exact")
        .page_size(page_size)
        .page(page)
        .user_id(user_id)
        .ids(ids.clone())
        .ids_only(true);

    let error = builder.build_content_bool_query().err().unwrap();

    assert_eq!(
        OpensearchClientError::EmptyIdsWithIdsOnly(OpenSearchEntityType::Documents),
        error
    );

    Ok(())
}

#[test]
fn test_build_bool_query() -> anyhow::Result<()> {
    let terms = vec!["test".to_string()];
    let ids = vec!["id1".to_string(), "id2".to_string()];
    let user_id = "user123";
    let page = 1;
    let page_size = 20;

    let builder = SearchQueryBuilder::<TestSearchConfig>::new(terms.clone())
        .match_type("exact")
        .page_size(page_size)
        .page(page)
        .user_id(user_id)
        .ids(ids.clone());

    let query = builder.build_content_bool_query()?;

    let expected = serde_json::json!({
        "bool": {
            "must": [
            {
                "bool": {
                    "minimum_should_match": 1,
                    "should": [
                        {
                            "match_phrase": {
                                "content": "test"
                            }
                        },
                    ],
                }
            },
            ],
            "filter": [
              {
              "bool": {
              "minimum_should_match": 1,
              "should": [
                {"terms": {"entity_id": ["id1", "id2"]}},
                {"term": {"test_user_id": "user123"}}
              ]
            }
          },
          {"term": {"_index": "documents"}}
        ]
        }
    });

    assert_eq!(query.build().to_json(), expected);

    let builder = SearchQueryBuilder::<TestSearchConfig>::new(terms)
        .match_type("partial")
        .page_size(page_size)
        .page(page)
        .user_id(user_id)
        .ids_only(true)
        .ids(ids.clone());

    let query = builder.build_content_bool_query()?;

    let expected = serde_json::json!({
        "bool": {
            "must": [
            {
                "bool": {
                    "minimum_should_match": 1,
                    "should": [
                        {
                            "match_phrase_prefix": {
                                "content": {
                                    "query": "test",
                                    "max_expansions": 256
                                }
                            }
                        },
                    ],
                }
            },
            ],
            "filter": [
                {"terms": {"entity_id": ["id1", "id2"]}},
                {"term": {"_index": "documents"}}
        ]
    }
    });

    assert_eq!(query.build().to_json(), expected);

    Ok(())
}

#[test]
fn test_build_must_term_query() -> anyhow::Result<()> {
    let terms = vec!["test".to_string()];

    let builder = SearchQueryBuilder::<TestSearchConfig>::new(terms.clone()).match_type("exact");

    let terms_must_vec = builder.build_must_term_query()?;

    let expected = serde_json::json!({
        "match_phrase": {
            "content": "test"
        }
    });

    assert_eq!(terms_must_vec.len(), 1);
    assert_eq!(terms_must_vec[0].to_json(), expected);

    let builder = SearchQueryBuilder::<TestSearchConfig>::new(terms.clone()).match_type("partial");

    let terms_must_vec = builder.build_must_term_query()?;

    let expected = serde_json::json!({
        "match_phrase_prefix": {
            "content": {
                "query": "test",
                "max_expansions": 256
            }
        }
    });

    assert_eq!(terms_must_vec.len(), 1);
    assert_eq!(terms_must_vec[0].to_json(), expected);

    Ok(())
}

#[test]
fn test_build_must_term_query_multiple_terms() -> anyhow::Result<()> {
    let terms = vec!["test1".to_string(), "test2".to_string()];

    let builder = SearchQueryBuilder::<TestSearchConfig>::new(terms.clone()).match_type("exact");

    let terms_must_vec = builder.build_must_term_query()?;

    let expected = serde_json::json!({
        "bool": {
            "minimum_should_match": 1,
            "should": [
                {
                    "match_phrase": {
                        "content": "test1"
                    }
                },
                {
                    "match_phrase": {
                        "content": "test2"
                    }
                }
            ]
        }
    });

    assert_eq!(terms_must_vec.len(), 1);
    assert_eq!(terms_must_vec[0].to_json(), expected);

    Ok(())
}

#[test]
fn test_build_must_term_query_short_last_word_no_wildcard() -> anyhow::Result<()> {
    let terms = vec!["test Ab".to_string()];
    let builder = SearchQueryBuilder::<TestSearchConfig>::new(terms).match_type("partial");

    let terms_must_vec = builder.build_must_term_query()?;

    let expected = serde_json::json!({
        "match_phrase_prefix": {
            "content": {
                "query": "test Ab",
                "max_expansions": 256
            }
        }
    });

    assert_eq!(terms_must_vec.len(), 1);
    assert_eq!(terms_must_vec[0].to_json(), expected);

    Ok(())
}
