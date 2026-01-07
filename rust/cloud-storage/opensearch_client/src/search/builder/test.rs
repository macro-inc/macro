use super::*;

use opensearch_query_builder::ToOpenSearchJson;

struct TestSearchConfig;

impl SearchQueryConfig for TestSearchConfig {
    const USER_ID_KEY: &'static str = "test_user_id";
    const TITLE_KEY: &'static str = "test_title";
    const ENTITY_INDEX: SearchEntityType = SearchEntityType::Documents;

    fn append_owner_highlights<'a>(
        highlight: opensearch_query_builder::Highlight<'a>,
    ) -> opensearch_query_builder::Highlight<'a> {
        highlight.field("test_user_id", create_highlight_field("plain", 1))
    }
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
fn test_build_search_request() -> anyhow::Result<()> {
    let bool_query = QueryType::bool_query().build();

    let builder = SearchQueryBuilder::<TestSearchConfig>::new(vec!["test".to_string()])
        .match_type("exact")
        .page_size(20)
        .page(1)
        .user_id("user123")
        .search_on(SearchOn::Content)
        .collapse(true)
        .ids(vec!["id1".to_string(), "id2".to_string()])
        .ids_only(true);

    let result = builder.build_search_request(bool_query.clone())?;

    let expected = serde_json::json!({
        "from": 20,
        "size": 20,
        "collapse": {
            "field": "entity_id"
        },
        "sort": TestSearchConfig::default_sort_types().iter().map(|s| s.to_json()).collect::<Vec<_>>(),
        "highlight": TestSearchConfig::append_owner_highlights(TestSearchConfig::default_highlight()).to_json(),
        "query": {
            "bool": {}
        }
    });

    assert_eq!(result.to_json(), expected);

    let builder = SearchQueryBuilder::<TestSearchConfig>::new(vec!["test".to_string()])
        .match_type("partial")
        .page_size(20)
        .page(1)
        .user_id("user123")
        .search_on(SearchOn::NameContent)
        .collapse(true)
        .ids(vec!["id1".to_string(), "id2".to_string()]);

    let result = builder.build_search_request(bool_query.clone())?;

    let expected = serde_json::json!({
        "track_total_hits": true,
        "from": 20,
        "size": 20,
        "aggs": {
            "total_uniques": {
                "cardinality": {
                    "field": "entity_id"
                }
            }
        },
        "collapse": {
            "field": "entity_id"
        },
       "sort": TestSearchConfig::default_sort_types().iter().map(|s| s.to_json()).collect::<Vec<_>>(),
        "highlight": {
            "require_field_match": false,
            "fields": {
                "content": {
                    "type": "plain",
                    "number_of_fragments": 1,
                    "pre_tags": ["<macro_em>"],
                    "post_tags": ["</macro_em>"],
                },
                "test_title": {
                    "type": "plain",
                    "number_of_fragments": 1,
                    "pre_tags": ["<macro_em>"],
                    "post_tags": ["</macro_em>"],
                },
                "test_user_id": {
                    "type": "plain",
                    "number_of_fragments": 1,
                    "pre_tags": ["<macro_em>"],
                    "post_tags": ["</macro_em>"],
                }
            }
        },
        "query": {
            "function_score": {
                "boost_mode": "multiply",
                "functions": [
                    {
                        "gauss": {
                            "updated_at_seconds": {
                                "decay": 0.5,
                                "offset": "3d",
                                "origin": "now",
                                "scale": "21d"
                            }
                        },
                        "weight": 1.3
                    }
                ],
                "query": {
                    "bool": {}
                },
                "score_mode": "multiply"
            }
        }
    });

    assert_eq!(result.to_json(), expected);

    let builder = SearchQueryBuilder::<TestSearchConfig>::new(vec!["test".to_string()])
        .match_type("partial")
        .page_size(20)
        .page(1)
        .user_id("user123")
        .search_on(SearchOn::NameContent)
        .collapse(true)
        .disable_recency(true)
        .ids(vec!["id1".to_string(), "id2".to_string()]);

    let result = builder.build_search_request(bool_query)?;

    let expected = serde_json::json!({
        "from": 20,
        "size": 20,
        "collapse": {
            "field": "entity_id"
        },
        "sort": TestSearchConfig::default_sort_types().iter().map(|s| s.to_json()).collect::<Vec<_>>(),
        "highlight": {
            "require_field_match": false,
            "fields": {
                "content": {
                    "type": "plain",
                    "number_of_fragments": 1,
                    "pre_tags": ["<macro_em>"],
                    "post_tags": ["</macro_em>"],
                },
                "test_title": {
                    "type": "plain",
                    "number_of_fragments": 1,
                    "pre_tags": ["<macro_em>"],
                    "post_tags": ["</macro_em>"],
                },
                "test_user_id": {
                    "type": "plain",
                    "number_of_fragments": 1,
                    "pre_tags": ["<macro_em>"],
                    "post_tags": ["</macro_em>"],
                }
            }
        },
        "query": {
            "bool": {}
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
        .search_on(SearchOn::Content)
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
        .search_on(SearchOn::Content)
        .ids(ids.clone())
        .ids_only(true);

    let error = builder.build_content_bool_query().err().unwrap();

    assert_eq!(
        OpensearchClientError::EmptyIdsWithIdsOnly(SearchEntityType::Documents),
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
        .search_on(SearchOn::Content)
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
                            "wildcard": {
                                "test_user_id": {
                                    "value": "macro|test*",
                                    "case_insensitive": true,
                                    "boost": 5000.0
                                }
                            }
                        },
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

    let builder = SearchQueryBuilder::<TestSearchConfig>::new(terms.clone())
        .match_type("partial")
        .page_size(page_size)
        .page(page)
        .user_id(user_id)
        .ids_only(true)
        .search_on(SearchOn::Content)
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
                            "wildcard": {
                                "test_user_id": {
                                    "value": "macro|test*",
                                    "case_insensitive": true,
                                    "boost": 5000.0
                                }
                            }
                        },
                        {
                            "match_phrase_prefix": {
                                "content": {
                                    "query": "test",
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

    let builder = SearchQueryBuilder::<TestSearchConfig>::new(terms)
        .match_type("partial")
        .page_size(page_size)
        .page(page)
        .user_id(user_id)
        .ids_only(true)
        .search_on(SearchOn::NameContent)
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
                    "wildcard": {
                      "test_user_id": {
                        "case_insensitive": true,
                        "value": "macro|test*",
                        "boost": 5000.0
                      }
                    }
                  },
                  {
                    "match_phrase_prefix": {
                      "content": {
                        "query": "test"
                      }
                    }
                  }
                ]
              }
            },
          ],
          "filter": [
            {
              "terms": {
                "entity_id": ["id1", "id2"]
              }
            },
            {
                "term": {
                    "_index": "documents",
                }
            }
          ]
        }
    });

    assert_eq!(query.build().to_json(), expected);

    Ok(())
}

#[test]
fn test_build_must_term_query() -> anyhow::Result<()> {
    let terms = vec!["test".to_string()];

    let builder = SearchQueryBuilder::<TestSearchConfig>::new(terms.clone())
        .match_type("exact")
        .search_on(SearchOn::Content);

    let terms_must_vec = builder.build_must_term_query(SearchOn::Content)?;

    let expected = serde_json::json!({
        "match_phrase": {
            "content": "test"
        }
    });

    assert_eq!(terms_must_vec.len(), 1);
    assert_eq!(terms_must_vec[0].to_json(), expected);

    let builder = SearchQueryBuilder::<TestSearchConfig>::new(terms.clone())
        .match_type("exact")
        .search_on(SearchOn::Name);

    let terms_must_vec = builder.build_must_term_query(SearchOn::Name)?;

    let expected = serde_json::json!({
        "match_phrase": {
            "test_title": "test"
        }
    });

    assert_eq!(terms_must_vec.len(), 1);
    assert_eq!(terms_must_vec[0].to_json(), expected);

    let builder = SearchQueryBuilder::<TestSearchConfig>::new(terms.clone())
        .match_type("partial")
        .search_on(SearchOn::Content);

    let terms_must_vec = builder.build_must_term_query(SearchOn::Content)?;

    let expected = serde_json::json!({
        "match_phrase_prefix": {
            "content": {
                "query": "test",
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

    let builder = SearchQueryBuilder::<TestSearchConfig>::new(terms.clone())
        .match_type("exact")
        .search_on(SearchOn::Content);

    let terms_must_vec = builder.build_must_term_query(SearchOn::Content)?;

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
fn test_build_must_term_query_term_with_short_last_word() -> anyhow::Result<()> {
    let terms = vec!["test Ab".to_string()];
    let builder = SearchQueryBuilder::<TestSearchConfig>::new(terms)
        .match_type("partial")
        .search_on(SearchOn::Content);

    let terms_must_vec = builder.build_must_term_query(SearchOn::Content)?;

    let expected = serde_json::json!({
        "bool": {
            "must": [
                {
                    "match_phrase_prefix": {
                        "content": {
                            "query": "test",
                        }
                    }
                },
                {
                    "wildcard": {
                        "content": {
                            "case_insensitive": true,
                            "value": "*ab*",
                        }
                    }
                }
            ]
        }
    });

    assert_eq!(terms_must_vec.len(), 1);
    assert_eq!(terms_must_vec[0].to_json(), expected);

    Ok(())
}
