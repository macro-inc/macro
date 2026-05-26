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
