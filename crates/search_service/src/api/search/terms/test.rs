use std::sync::atomic::{AtomicUsize, Ordering};

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

struct Rollout {
    enabled: bool,
    reads: AtomicUsize,
}

impl Rollout {
    fn new(enabled: bool) -> Self {
        Self {
            enabled,
            reads: AtomicUsize::new(0),
        }
    }
}

#[async_trait::async_trait]
impl TermMatchingRollout for Rollout {
    async fn dynamic_enabled_for(&self, _caller: MacroUserIdStr<'_>) -> bool {
        self.reads.fetch_add(1, Ordering::SeqCst);
        self.enabled
    }
}

const CALLER: &str = "macro|person@example.com";

#[tokio::test]
async fn a_request_that_does_not_ask_stays_strict_without_reading_the_rollout() {
    let rollout = Rollout::new(true);

    let matching = resolve_document_term_matching(&rollout, CALLER, TermMatching::All, 7).await;

    assert_eq!(matching, DocumentTermMatching::All);
    assert_eq!(rollout.reads.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn a_dynamic_request_is_strict_while_the_rollout_is_off() {
    let rollout = Rollout::new(false);

    let matching = resolve_document_term_matching(&rollout, CALLER, TermMatching::Dynamic, 7).await;

    assert_eq!(matching, DocumentTermMatching::All);
    assert_eq!(rollout.reads.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn a_dynamic_request_is_dynamic_once_the_rollout_is_on() {
    let rollout = Rollout::new(true);

    let matching = resolve_document_term_matching(&rollout, CALLER, TermMatching::Dynamic, 3).await;

    assert_eq!(matching, DocumentTermMatching::Dynamic);
}

#[tokio::test]
async fn a_short_query_stays_strict_without_reading_the_rollout() {
    let rollout = Rollout::new(true);

    let matching = resolve_document_term_matching(&rollout, CALLER, TermMatching::Dynamic, 2).await;

    assert_eq!(matching, DocumentTermMatching::All);
    assert_eq!(rollout.reads.load(Ordering::SeqCst), 0);
}

#[test]
fn a_request_without_the_field_asks_for_strict_matching() -> Result<(), serde_json::Error> {
    // The SDK and AI tools send no `term_matching`.
    let request: models_search::unified::UnifiedSearchRequest =
        serde_json::from_value(serde_json::json!({
            "query": "quarterly revenue forecast",
            "match_type": "partial",
        }))?;

    assert_eq!(request.term_matching, TermMatching::All);
    Ok(())
}

#[test]
fn trimmed_query_accepts_one_and_two_character_queries() {
    assert_eq!(trimmed_query("a").ok(), Some("a"));
    assert_eq!(trimmed_query(" pr ").ok(), Some("pr"));
    assert_eq!(trimmed_query("项").ok(), Some("项"));
}

#[test]
fn trimmed_query_rejects_a_blank_query() {
    assert!(matches!(trimmed_query(""), Err(SearchError::EmptyQuery)));
    assert!(matches!(
        trimmed_query(" \t "),
        Err(SearchError::EmptyQuery)
    ));
}
