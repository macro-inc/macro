use super::*;

use opensearch_query_builder::ToOpenSearchJson;

struct TestSearchConfig;

impl SearchQueryConfig for TestSearchConfig {
    const INDEX: &'static str = "test_index";
    const USER_ID_KEY: &'static str = "test_user_id";
    const TITLE_KEY: &'static str = "test_title";
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
        "highlight": TestSearchConfig::default_highlight().to_json(),
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
        "sort": [
            {
                "_score": "desc"
            },
            {
                "entity_id": "asc"
            }
        ],
        "highlight": {
            "require_field_match": false,
            "fields": {
                "content": {
                    "type": "unified",
                    "number_of_fragments": 1,
                    "pre_tags": ["<macro_em>"],
                    "post_tags": ["</macro_em>"],
                },
                "test_title": {
                    "type": "unified",
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
        "sort": [
            {
                "_score": "desc"
            },
            {
                "entity_id": "asc"
            }
        ],
        "highlight": {
            "require_field_match": false,
            "fields": {
                "content": {
                    "type": "unified",
                    "number_of_fragments": 1,
                    "pre_tags": ["<macro_em>"],
                    "post_tags": ["</macro_em>"],
                },
                "test_title": {
                    "type": "unified",
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
    let query = builder.build_bool_query()?;

    let expected = serde_json::json!({
        "bool": {
            "must": [
                {
                    "match_phrase": {
                        "content": "test"
                    }
                }
            ],
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
            ],
            "minimum_should_match": 1,
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

    let query = builder.build_bool_query()?;

    let expected = serde_json::json!({
        "bool": {
            "must": [
                {
                    "match_phrase_prefix": {
                        "content": {
                            "query": "test",
                        }
                    }
                }
            ],
            "should": [
                {
                    "terms": {
                        "entity_id": ["id1", "id2"]
                    }
                },
            ],
            "minimum_should_match": 1,
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

    let query = builder.build_bool_query()?;

    let expected = serde_json::json!({
        "bool": {
            "must": [
                {
                    "bool": {
                        "minimum_should_match": 1,
                        "should": [
                            {
                                "match_phrase_prefix": {
                                    "test_title": {
                                        "boost": 1000.0,
                                        "query": "test"
                                    }
                                }
                            },
                            {
                                "match_phrase_prefix": {
                                    "content": {
                                        "boost": 900.0,
                                        "query": "test"
                                    }
                                }
                            },
                            {
                                "match": {
                                    "test_title": {
                                        "boost": 0.1,
                                        "minimum_should_match": "80%",
                                        "query": "test"
                                    }
                                }
                            },
                            {
                                "match": {
                                    "content": {
                                        "boost": 0.09,
                                        "minimum_should_match": "1",
                                        "query": "test"
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
                        "entity_id": ["id1", "id2"]
                    }
                },
            ],
            "minimum_should_match": 1,
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

    let terms_must_vec = builder.build_must_term_query()?;

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

    let terms_must_vec = builder.build_must_term_query()?;

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

    let terms_must_vec = builder.build_must_term_query()?;

    let expected = serde_json::json!({
        "match_phrase_prefix": {
            "content": {
                "query": "test",
            }
        }
    });

    assert_eq!(terms_must_vec.len(), 1);
    assert_eq!(terms_must_vec[0].to_json(), expected);

    let builder = SearchQueryBuilder::<TestSearchConfig>::new(terms)
        .match_type("partial")
        .search_on(SearchOn::NameContent);

    let terms_must_vec = builder.build_must_term_query()?;

    let expected = serde_json::json!({
        "bool": {
            "minimum_should_match": 1,
            "should": [
                {
                    "match_phrase_prefix": {
                        "test_title": {
                            "query": "test",
                            "boost": 1000.0
                        }
                    }
                },
                {
                    "match_phrase_prefix": {
                        "content": {
                            "query": "test",
                            "boost": 900.0
                        }
                    }
                },
                {
                    "match": {
                        "test_title": {
                            "boost": 0.1,
                            "minimum_should_match": "80%",
                            "query": "test"
                        }
                    }
                },
                {
                    "match": {
                        "content": {
                            "boost": 0.09,
                            "minimum_should_match": "1",
                            "query": "test"
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

#[test]
fn test_build_must_term_query_multiple_terms() -> anyhow::Result<()> {
    let terms = vec!["test1".to_string(), "test2".to_string()];

    let builder = SearchQueryBuilder::<TestSearchConfig>::new(terms.clone())
        .match_type("exact")
        .search_on(SearchOn::Content);

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

    let builder = SearchQueryBuilder::<TestSearchConfig>::new(terms)
        .match_type("partial")
        .search_on(SearchOn::NameContent);

    let terms_must_vec = builder.build_must_term_query()?;

    let expected = serde_json::json!({
        "bool": {
            "minimum_should_match": 1,
            "should": [
            {
                "bool": {
                    "minimum_should_match": 1,
                    "should": [
                        {
                            "match_phrase_prefix": {
                                "test_title": {
                                    "boost": 1000.0,
                                    "query": "test1"
                                }
                            }
                        },
                        {
                            "match_phrase_prefix": {
                                "content": {
                                    "boost": 900.0,
                                    "query": "test1"
                                }
                            }
                        },
                        {
                            "match": {
                                "test_title": {
                                    "boost": 0.1,
                                    "minimum_should_match": "80%",
                                    "query": "test1"
                                }
                            }
                        },
                        {
                            "match": {
                                "content": {
                                    "boost": 0.09,
                                    "minimum_should_match": "1",
                                    "query": "test1"
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
                                "match_phrase_prefix": {
                                    "test_title": {
                                        "boost": 1000.0,
                                        "query": "test2"
                                    }
                                }
                            },
                            {
                                "match_phrase_prefix": {
                                    "content": {
                                        "boost": 900.0,
                                        "query": "test2"
                                    }
                                }
                            },
                            {
                                "match": {
                                    "test_title": {
                                        "boost": 0.1,
                                        "minimum_should_match": "80%",
                                        "query": "test2"
                                    }
                                }
                            },
                            {
                                "match": {
                                    "content": {
                                        "boost": 0.09,
                                        "minimum_should_match": "1",
                                        "query": "test2"
                                    }
                                }
                            }
                        ]
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

    let terms_must_vec = builder.build_must_term_query()?;

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
