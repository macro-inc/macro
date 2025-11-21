use super::*;

use opensearch_query_builder::ToOpenSearchJson;

#[test]
fn test_query_key_from_match_type() -> anyhow::Result<()> {
    assert_eq!(QueryKey::from_match_type("exact")?, QueryKey::MatchPhrase);
    assert_eq!(
        QueryKey::from_match_type("partial")?,
        QueryKey::MatchPhrasePrefix
    );
    assert_eq!(QueryKey::from_match_type("regexp")?, QueryKey::Regexp);

    let error = QueryKey::from_match_type("invalid").unwrap_err();

    assert_eq!(
        error,
        OpensearchClientError::InvalidMatchType {
            match_type: "invalid".to_string()
        }
    );

    Ok(())
}

#[test]
fn test_query_key_create_query() -> anyhow::Result<()> {
    let field = "test";
    let term = "test";
    let query_key = QueryKey::from_match_type("exact")?;

    let expected = serde_json::json!({
        "match_phrase": {
            "test": "test"
        }
    });

    let result = query_key.create_query(field, term).to_json();

    assert_eq!(result, expected);

    Ok(())
}

#[test]
fn test_query_key_short_last_word() -> anyhow::Result<()> {
    let field = "test";
    let term = "test Ab";

    let expected = serde_json::json!({
        "bool": {
            "must": [
                {
                    "match_phrase_prefix": {
                        "test": {
                            "query": "test",
                        }
                    }
                },
                {
                    "wildcard": {
                        "test": {
                            "case_insensitive": true,
                            "value": "*ab*",
                        }
                    }
                }
            ]
        }
    });

    let result = QueryKey::MatchPhrasePrefix
        .create_query(field, term)
        .to_json();

    assert_eq!(result, expected);

    Ok(())
}

#[test]
fn test_generate_terms_must_query() -> anyhow::Result<()> {
    let result = generate_terms_must_query(QueryKey::MatchPhrase, &["test"], &["test".to_string()]);

    let expected = serde_json::json!({
        "match_phrase": {
            "test": "test"
        }
    });

    assert_eq!(result.to_json(), expected);

    let result = generate_terms_must_query(
        QueryKey::MatchPhrasePrefix,
        &["test"],
        &["test".to_string(), "test2".to_string()],
    );

    let expected = serde_json::json!({
        "bool": {
            "minimum_should_match": 1,
            "should": [
                {
                    "match_phrase_prefix": {
                        "test": {
                            "query": "test",
                        }
                    }
                },
                {
                    "match_phrase_prefix": {
                        "test": {
                            "query": "test2",
                        }
                    }
                }
            ]
        }
    });

    assert_eq!(result.to_json(), expected);

    Ok(())
}

#[test]
fn test_generate_name_content_query() -> anyhow::Result<()> {
    let keys = Keys {
        title_key: Some("test_title"),
        content_key: "test_content",
    };

    let result = generate_name_content_query(&keys, &["test".to_string()]);

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
                        "test_content": {
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
                        "test_content": {
                            "boost": 0.09,
                            "minimum_should_match": "1",
                            "query": "test"
                        }
                    }
                }
            ]
        }
    });

    assert_eq!(result.to_json(), expected);

    let result = generate_name_content_query(&keys, &["test".to_string(), "test2".to_string()]);

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
                                        "query": "test"
                                    }
                                }
                            },
                            {
                                "match_phrase_prefix": {
                                    "test_content": {
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
                                    "test_content": {
                                        "boost": 0.09,
                                        "minimum_should_match": "1",
                                        "query": "test"
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
                                    "test_content": {
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
                                    "test_content": {
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

    assert_eq!(result.to_json(), expected);

    let keys = Keys {
        title_key: None,
        content_key: "test_content",
    };

    let result = generate_name_content_query(&keys, &["test".to_string()]);

    let expected = serde_json::json!({
        "bool": {
            "minimum_should_match": 1,
            "should": [
                {
                    "match_phrase_prefix": {
                        "test_content": {
                            "query": "test",
                            "boost": 900.0
                        }
                    }
                },
                {
                    "match": {
                        "test_content": {
                            "boost": 0.09,
                            "minimum_should_match": "1",
                            "query": "test"
                        }
                    }
                }
            ]
        }
    });

    assert_eq!(result.to_json(), expected);

    Ok(())
}
