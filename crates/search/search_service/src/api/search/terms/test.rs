use super::*;

#[test]
fn test_split_search_terms_simple() {
    assert_eq!(
        split_search_terms(&["hello world".to_string()]),
        vec!["hello", "world"]
    );
}

#[test]
fn test_split_search_terms_multiple_spaces() {
    assert_eq!(
        split_search_terms(&["hello   world".to_string()]),
        vec!["hello", "world"]
    );
}

#[test]
fn test_split_search_terms_single_word() {
    assert_eq!(split_search_terms(&["hello".to_string()]), vec!["hello"]);
}

#[test]
fn test_split_search_terms_strips_quotes() {
    assert_eq!(
        split_search_terms(&[r#""hello""#.to_string()]),
        vec!["hello"]
    );
}

#[test]
fn test_split_search_terms_quoted_phrases() {
    assert_eq!(
        split_search_terms(&[r#""hello world" test "foo bar""#.to_string()]),
        vec!["hello world", "test", "foo bar"]
    );
}

#[test]
fn test_split_search_terms_quoted_mixed_with_unquoted() {
    assert_eq!(
        split_search_terms(&[r#"foo "bar" baz"#.to_string()]),
        vec!["foo", "bar", "baz"]
    );
}

#[test]
fn test_split_search_terms_empty_string() {
    let result: Vec<String> = split_search_terms(&["".to_string()]);
    assert!(result.is_empty());
}

#[test]
fn test_split_search_terms_leading_trailing_whitespace() {
    assert_eq!(
        split_search_terms(&["  hello world  ".to_string()]),
        vec!["hello", "world"]
    );
}

fn terms(input: &[&str]) -> Vec<String> {
    input.iter().map(|term| term.to_string()).collect()
}

#[test]
fn drop_wordless_terms_removes_bare_punctuation_from_word_queries() {
    for match_type in [MatchType::Partial, MatchType::Exact] {
        assert_eq!(
            drop_wordless_terms(terms(&["OOO", "-", "therapy"]), match_type),
            vec!["OOO", "therapy"]
        );
        assert_eq!(
            drop_wordless_terms(terms(&["ux", "invite", "@", "Sat", "&", "|"]), match_type),
            vec!["ux", "invite", "Sat"]
        );
    }
}

#[test]
fn drop_wordless_terms_keeps_punctuation_inside_words() {
    let input = terms(&[
        "[jackson]",
        "(Orillia)",
        "fold-in",
        "@gab",
        "11:30am",
        "café",
        "日本",
    ]);
    assert_eq!(
        drop_wordless_terms(input.clone(), MatchType::Partial),
        input
    );
}

#[test]
fn drop_wordless_terms_keeps_regexp_and_query_syntax() {
    for match_type in [MatchType::Regexp, MatchType::Query] {
        let input = terms(&["foo", ".*", "-"]);
        assert_eq!(drop_wordless_terms(input.clone(), match_type), input);
    }
}

#[test]
fn drop_wordless_terms_leaves_a_query_of_only_punctuation_unchanged() {
    let input = terms(&["---", "@"]);
    assert_eq!(
        drop_wordless_terms(input.clone(), MatchType::Partial),
        input
    );
}
