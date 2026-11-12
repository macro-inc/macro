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
fn test_generate_terms_must_query_single_term() -> anyhow::Result<()> {
    let terms: Cow<'_, [&str]> = Cow::Borrowed(&["test"]);

    let result = generate_terms_must_query(QueryKey::MatchPhrase, "test", terms, TermCombine::And);

    let expected = serde_json::json!({
        "match_phrase": {
            "test": "test"
        }
    });

    assert_eq!(result.to_json(), expected);

    Ok(())
}

#[test]
fn test_generate_terms_must_query_and_combine() -> anyhow::Result<()> {
    let terms: Cow<'_, [&str]> = Cow::Borrowed(&["foo", "bar"]);
    let result =
        generate_terms_must_query(QueryKey::MatchPhrase, "content", terms, TermCombine::And);

    let expected = serde_json::json!({
        "bool": {
            "must": [
                { "match_phrase": { "content": "foo" } },
                { "match_phrase": { "content": "bar" } }
            ]
        }
    });

    assert_eq!(result.to_json(), expected);

    Ok(())
}

#[test]
fn test_create_query_partial_single_word_is_bool_prefix() {
    let result = create_query(CreateQueryParams {
        query_key: QueryKey::MatchPhrasePrefix,
        field: "subject",
        term: "invoice",
    })
    .to_json();

    assert_eq!(
        result,
        serde_json::json!({ "match_bool_prefix": { "subject": { "query": "invoice" } } })
    );
}

#[test]
fn test_create_query_exact_single_word_stays_match_phrase() {
    let result = create_query(CreateQueryParams {
        query_key: QueryKey::MatchPhrase,
        field: "subject",
        term: "invoice",
    })
    .to_json();

    assert_eq!(
        result,
        serde_json::json!({ "match_phrase": { "subject": "invoice" } })
    );
}

#[test]
fn test_is_single_word_accepts_one_standard_token() {
    for term in [
        "a",
        "invoice",
        "Invoice",
        "q3",
        "2026",
        "snake_case",
        "don't",
        "don’t",
        "e.g",
        "3.14",
        "invoice,",
        "(draft)",
        "#tag",
        "@alice",
        "über",
        "café",
        "한국어",
    ] {
        assert!(is_single_word(term), "{term:?} should be one token");
    }
}

#[test]
fn test_is_single_word_rejects_terms_that_tokenize_to_several() {
    for term in [
        "",
        "...",
        "hello world",
        "foo-bar",
        "alice@example.com",
        "a.1",
        "1.a",
        "foo/bar",
        "’tis",
        "rock’",
        "東京",
        "日本語",
        "テスト",
    ] {
        assert!(!is_single_word(term), "{term:?} should not be one token");
    }
}
