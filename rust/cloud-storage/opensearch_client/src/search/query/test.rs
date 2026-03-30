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
    })
    .to_json();

    assert_eq!(result, expected);

    Ok(())
}

#[test]
fn test_query_key_create_query_partial() -> anyhow::Result<()> {
    let field = "test";
    let term = "test Ab";

    let expected = serde_json::json!({
        "match_phrase_prefix": {
            "test": {
                "query": "test Ab",
                "max_expansions": 256
            }
        }
    });

    let result = create_query(CreateQueryParams {
        query_key: QueryKey::MatchPhrasePrefix,
        field,
        term,
    })
    .to_json();

    assert_eq!(result, expected);

    Ok(())
}

#[test]
fn test_generate_terms_must_query() -> anyhow::Result<()> {
    let terms: Cow<'_, [&str]> = Cow::Borrowed(&["test"]);

    let result = generate_terms_must_query(QueryKey::MatchPhrase, "test", terms);

    let expected = serde_json::json!({
        "match_phrase": {
            "test": "test"
        }
    });

    assert_eq!(result.to_json(), expected);

    let terms: Cow<'_, [&str]> = Cow::Borrowed(&["test", "test2"]);
    let result = generate_terms_must_query(QueryKey::MatchPhrasePrefix, "test", terms);

    let expected = serde_json::json!({
        "bool": {
            "minimum_should_match": 1,
            "should": [
                {
                    "match_phrase_prefix": {
                        "test": {
                            "query": "test",
                            "max_expansions": 256
                        }
                    }
                },
                {
                    "match_phrase_prefix": {
                        "test": {
                            "query": "test2",
                            "max_expansions": 256
                        }
                    }
                }
            ]
        }
    });

    assert_eq!(result.to_json(), expected);

    Ok(())
}
