use super::{
    CALL_NAME_MAX_CHARS, NULL_SUMMARY_SENTINEL, UNTITLED_CALL_SENTINEL, parse_summary,
    sanitize_call_name,
};

#[test]
fn parse_summary_returns_none_for_null_sentinel() {
    assert_eq!(parse_summary(NULL_SUMMARY_SENTINEL), None);
    assert_eq!(parse_summary("null"), None);
    assert_eq!(parse_summary("  NULL  "), None);
    assert_eq!(parse_summary("\"NULL\""), None);
    assert_eq!(parse_summary("`null`"), None);
}

#[test]
fn parse_summary_returns_none_for_empty_input() {
    assert_eq!(parse_summary(""), None);
    assert_eq!(parse_summary("   \n\t"), None);
    assert_eq!(parse_summary("\"\""), None);
}

#[test]
fn parse_summary_strips_surrounding_quotes_and_whitespace() {
    assert_eq!(
        parse_summary("  \"Alex and Priya reviewed Q3 spend.\"  ").as_deref(),
        Some("Alex and Priya reviewed Q3 spend.")
    );
}

#[test]
fn parse_summary_preserves_real_summary_text() {
    let input = "Alex and Priya reviewed Q3 marketing spend and agreed to cut paid \
                 search by 20% next quarter.";
    assert_eq!(parse_summary(input).as_deref(), Some(input));
}

#[test]
fn parse_summary_does_not_mistake_substring_for_sentinel() {
    // Real summary that happens to contain the word "null" — must not be
    // suppressed.
    let input = "Discussed handling of null fields in the API response.";
    assert_eq!(parse_summary(input).as_deref(), Some(input));
}

#[test]
fn sanitize_strips_quotes_and_whitespace() {
    assert_eq!(
        sanitize_call_name("  \"Q4 Planning Sync\"  ").as_deref(),
        Some("Q4 Planning Sync")
    );
    assert_eq!(
        sanitize_call_name("'Standup Prep'").as_deref(),
        Some("Standup Prep")
    );
    assert_eq!(
        sanitize_call_name("`Rocket Launch`").as_deref(),
        Some("Rocket Launch")
    );
}

#[test]
fn sanitize_returns_none_for_empty_or_quote_only_input() {
    assert_eq!(sanitize_call_name(""), None);
    assert_eq!(sanitize_call_name("   "), None);
    assert_eq!(sanitize_call_name("\"\""), None);
}

#[test]
fn sanitize_returns_none_for_untitled_sentinel() {
    assert_eq!(sanitize_call_name(UNTITLED_CALL_SENTINEL), None);
    assert_eq!(sanitize_call_name("untitled_call"), None);
    assert_eq!(sanitize_call_name("  \"UNTITLED_CALL\"  "), None);
}

#[test]
fn sanitize_collapses_internal_unicode_whitespace() {
    assert_eq!(
        sanitize_call_name("  \"Weekly\nPlanning\tSync\u{00a0}Notes\"  ").as_deref(),
        Some("Weekly Planning Sync Notes")
    );
}

#[test]
fn sanitize_truncates_to_word_boundary_under_cap() {
    let input = "Quarterly Goals Sync ".repeat(20);
    let out = sanitize_call_name(&input).expect("non-empty input should sanitize to Some");
    assert!(out.chars().count() <= CALL_NAME_MAX_CHARS);
    assert!(!out.ends_with(' '));
    assert!(out.starts_with("Quarterly Goals Sync"));
}

#[test]
fn sanitize_preserves_short_titles_verbatim() {
    let input = "Rocket Launch Postmortem";
    assert_eq!(sanitize_call_name(input).as_deref(), Some(input));
}
