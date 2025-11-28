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

    let result = create_query(CreateQueryParams {
        query_key,
        field,
        term,
        unified_params: None,
    })
    .to_json();

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

    let result = create_query(CreateQueryParams {
        query_key: QueryKey::MatchPhrasePrefix,
        field,
        term,
        unified_params: None,
    })
    .to_json();

    assert_eq!(result, expected);

    Ok(())
}

#[test]
fn test_generate_terms_must_query() -> anyhow::Result<()> {
    let terms: Cow<'_, [&str]> = Cow::Borrowed(&["test"]);

    let result = generate_terms_must_query(QueryKey::MatchPhrase, "test", terms, None);

    let expected = serde_json::json!({
        "match_phrase": {
            "test": "test"
        }
    });

    assert_eq!(result.to_json(), expected);

    let terms: Cow<'_, [&str]> = Cow::Borrowed(&["test", "test2"]);
    let result = generate_terms_must_query(QueryKey::MatchPhrasePrefix, "test", terms, None);

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
fn test_create_query_unified_name() -> anyhow::Result<()> {
    let field = "test";
    let term = "test";
    let query_key = QueryKey::MatchPhrase;

    let expected = serde_json::json!({
        "bool": {
            "minimum_should_match": 1,
            "should": [
                {
                    "match_phrase_prefix": {
                        "test": {
                            "query": "test",
                            "boost": 1000.0
                        }
                    }
                },
                {
                    "match": {
                        "test": {
                            "boost": 0.1,
                            "minimum_should_match": "80%",
                            "query": "test"
                        }
                    }
                }
            ]
        }
    });

    let result = create_query(CreateQueryParams {
        query_key,
        field,
        term,
        unified_params: Some(&CreateQueryUnifiedParams {
            name_or_content: NameOrContent::Name,
        }),
    })
    .to_json();

    assert_eq!(result, expected);

    Ok(())
}

#[test]
fn test_create_query_unified_content() -> anyhow::Result<()> {
    let field = "test";
    let term = "test";
    let query_key = QueryKey::MatchPhrase;

    let expected = serde_json::json!({
        "bool": {
            "minimum_should_match": 1,
            "should": [
                {
                    "match_phrase_prefix": {
                        "test": {
                            "query": "test",
                            "boost": 900.0
                        }
                    }
                },
                {
                    "match": {
                        "test": {
                            "boost": 0.09,
                            "minimum_should_match": "1",
                            "query": "test"
                        }
                    }
                }
            ]
        }
    });

    let result = create_query(CreateQueryParams {
        query_key,
        field,
        term,
        unified_params: Some(&CreateQueryUnifiedParams {
            name_or_content: NameOrContent::Content,
        }),
    })
    .to_json();

    assert_eq!(result, expected);

    Ok(())
}
