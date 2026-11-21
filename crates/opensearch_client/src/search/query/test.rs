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

/// Only a term the analyzer reads as one token of three or more characters
/// becomes an uncapped prefix; every other term keeps its phrase query.
#[test]
fn a_content_term_is_an_uncapped_prefix_only_when_it_is_one_long_enough_token() {
    let long_word = "a".repeat(256);
    let cases = [
        (
            "con.",
            serde_json::json!({"match_bool_prefix": {"content": {"query": "con"}}}),
        ),
        (
            "naïve",
            serde_json::json!({"match_bool_prefix": {"content": {"query": "naïve"}}}),
        ),
        (
            "c++",
            serde_json::json!({"match_phrase": {"content": "c++"}}),
        ),
        (
            "#go",
            serde_json::json!({"match_phrase": {"content": "#go"}}),
        ),
        (
            "e-mail",
            serde_json::json!({"match_phrase_prefix": {"content": {"query": "e-mail", "max_expansions": 256}}}),
        ),
        (
            "abc\u{200d}👍",
            serde_json::json!({"match_phrase_prefix": {"content": {"query": "abc\u{200d}👍", "max_expansions": 256}}}),
        ),
        (
            "it’s",
            serde_json::json!({"match_bool_prefix": {"content": {"query": "it’s"}}}),
        ),
        (
            "cafe\u{0301}",
            serde_json::json!({"match_bool_prefix": {"content": {"query": "cafe\u{0301}"}}}),
        ),
        (
            "👍abc",
            serde_json::json!({"match_phrase_prefix": {"content": {"query": "👍abc", "max_expansions": 256}}}),
        ),
        (
            long_word.as_str(),
            serde_json::json!({"match_phrase_prefix": {"content": {"query": long_word, "max_expansions": 256}}}),
        ),
    ];
    for (term, expected) in cases {
        assert_eq!(
            child_content_query(term, "partial").to_json(),
            expected,
            "{term}"
        );
    }
}

/// A name prefix of one word under three characters keeps the capped phrase
/// prefix; a longer word expands in full.
#[test]
fn a_field_prefix_expands_in_full_only_for_one_word_of_three_or_more_characters() {
    let query = |term| {
        create_query(CreateQueryParams {
            query_key: QueryKey::MatchPhrasePrefix,
            field: "name",
            term,
        })
        .to_json()
    };
    assert_eq!(
        query("co"),
        serde_json::json!({"match_phrase_prefix": {"name": {"query": "co", "max_expansions": 256}}})
    );
    assert_eq!(
        query("conveyor."),
        serde_json::json!({"match_bool_prefix": {"name": {"query": "conveyor"}}})
    );
}
