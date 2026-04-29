use super::{CALL_NAME_MAX_CHARS, UNTITLED_CALL_SENTINEL, sanitize_call_name};

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
