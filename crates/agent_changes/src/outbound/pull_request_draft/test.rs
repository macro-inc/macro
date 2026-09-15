use super::*;

#[test]
fn a_json_answer_is_read_as_is() {
    let draft = parse_draft(
        r#"{"title": "Clear the unread dot on archive.", "body": "Body\n\n## Test plan\n- run"}"#,
        "fallback",
    )
    .unwrap();
    assert_eq!(draft.title, "Clear the unread dot on archive");
    assert!(draft.body.starts_with("Body"));
}

#[test]
fn a_fenced_json_answer_is_unwrapped() {
    let draft = parse_draft(
        "```json\n{\"title\": \"Add caching\", \"body\": \"Caches.\"}\n```",
        "fallback",
    )
    .unwrap();
    assert_eq!(draft.title, "Add caching");
    assert_eq!(draft.body, "Caches.");
}

#[test]
fn prose_falls_back_to_first_line_title() {
    let draft = parse_draft("# Fix the flaky test\n\nIt was flaky.", "fallback").unwrap();
    assert_eq!(draft.title, "Fix the flaky test");
    assert_eq!(draft.body, "It was flaky.");
}

#[test]
fn an_empty_answer_uses_the_session_name() {
    let draft = parse_draft("", "Session Name").unwrap();
    assert_eq!(draft.title, "Session Name");
    assert_eq!(draft.body, "");
}

#[test]
fn titles_are_bounded() {
    let long = "x".repeat(500);
    assert_eq!(clean_title(&long).chars().count(), MAX_TITLE_CHARS);
}
