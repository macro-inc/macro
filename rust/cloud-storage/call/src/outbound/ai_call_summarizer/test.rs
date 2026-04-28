use super::{CALL_NAME_MAX_CHARS, sanitize_call_name};

#[test]
fn sanitize_strips_quotes_and_whitespace() {
    assert_eq!(
        sanitize_call_name("  \"Q4 Planning Sync\"  "),
        "Q4 Planning Sync"
    );
    assert_eq!(sanitize_call_name("'Standup Prep'"), "Standup Prep");
    assert_eq!(sanitize_call_name("`Rocket Launch`"), "Rocket Launch");
}

#[test]
fn sanitize_falls_back_to_untitled_for_empty_or_quote_only_input() {
    assert_eq!(sanitize_call_name(""), "Untitled Call");
    assert_eq!(sanitize_call_name("   "), "Untitled Call");
    assert_eq!(sanitize_call_name("\"\""), "Untitled Call");
}

#[test]
fn sanitize_collapses_internal_unicode_whitespace() {
    assert_eq!(
        sanitize_call_name("  \"Weekly\nPlanning\tSync\u{00a0}Notes\"  "),
        "Weekly Planning Sync Notes"
    );
}

#[test]
fn sanitize_truncates_to_word_boundary_under_cap() {
    let input = "Quarterly Goals Sync ".repeat(20);
    let out = sanitize_call_name(&input);
    assert!(out.chars().count() <= CALL_NAME_MAX_CHARS);
    assert!(!out.ends_with(' '));
    assert!(out.starts_with("Quarterly Goals Sync"));
}

#[test]
fn sanitize_preserves_short_titles_verbatim() {
    let input = "Rocket Launch Postmortem";
    assert_eq!(sanitize_call_name(input), input);
}
